import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { useRosMap, type MapData } from '../hooks/useRosMap';
import { useRosTfTree } from '../hooks/useRosTf';
import { useGoalPublisher, useInitialPosePublisher, useRosPath } from '../hooks/useRosPath';
import { useRosScan } from '../hooks/useRosScan';
import { useMode } from '../hooks/useMode';
import type { NavigationPose, NavigationTaskMode } from '../hooks/useNavigationTasks';
import { useLayers } from './LayerControl';

interface MapCanvasProps {
  ros: ROSLIB.Ros | null;
  isConnected: boolean;
  mapTopic?: string;
  navClickMode?: 'none' | 'initial_pose' | 'goal' | 'waypoint';
  setNavClickMode?: (mode: 'none' | 'initial_pose' | 'goal' | 'waypoint') => void;
  selectedMap?: string | null;
  navigationTaskMode?: NavigationTaskMode;
  navigationPoints?: NavigationPose[];
  pathResetToken?: number;
  onGoalPoseSelected?: (pose: NavigationPose) => void;
  onWaypointAdded?: (pose: NavigationPose) => void;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MAX_SCAN_POINTS = 360;

export function MapCanvas({
  ros,
  isConnected,
  mapTopic = '/map',
  navClickMode = 'none',
  setNavClickMode,
  selectedMap = null,
  navigationTaskMode = 'single',
  navigationPoints = [],
  pathResetToken = 0,
  onGoalPoseSelected,
  onWaypointAdded,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapLayerRef = useRef<HTMLCanvasElement>(null);
  const pathLayerRef = useRef<HTMLCanvasElement>(null);
  const liveLayerRef = useRef<HTMLCanvasElement>(null);
  const interactionLayerRef = useRef<HTMLCanvasElement>(null);
  const mapRasterRef = useRef<HTMLCanvasElement | null>(null);

  const [view, setView] = useState<ViewState>({ scale: 50, offsetX: 0, offsetY: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [navDrag, setNavDrag] = useState<{
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    mode: 'initial_pose' | 'goal' | 'waypoint';
  } | null>(null);

  const { layers, subscriptionSettings } = useLayers();
  const { mode } = useMode();
  const isPaused = subscriptionSettings.paused;

  const mapPaused = isPaused || !layers.map;
  const tfPaused = isPaused || !layers.tf;
  const pathPaused = isPaused || (!layers.globalPlan && !layers.localPlan);
  const scanPaused = isPaused || !layers.scan;

  const { mapData, robotPose } = useRosMap(ros, mapTopic, mapPaused);
  const { robotPose: tfPose } = useRosTfTree(ros, tfPaused);
  const { globalPath, localPath } = useRosPath(ros, '/plan', '/local_plan', pathPaused, pathResetToken);
  const { publishGoal } = useGoalPublisher(ros, '/goal_pose');
  const { publishInitialPose } = useInitialPosePublisher(ros, '/initialpose');
  const { scanData } = useRosScan(ros, '/scan', scanPaused);

  const actualPose = tfPose || robotPose;
  const [frozenNavMap, setFrozenNavMap] = useState<MapData | null>(null);
  const [displayMapData, setDisplayMapData] = useState<MapData | null>(null);
  const [displayPose, setDisplayPose] = useState<{ x: number; y: number; theta: number } | null>(null);

  useEffect(() => {
    if (mode !== 'navigation') {
      setFrozenNavMap(null);
      return;
    }

    if (!frozenNavMap && mapData) {
      setFrozenNavMap(mapData);
    }
  }, [mode, mapData, frozenNavMap]);

  useEffect(() => {
    if (subscriptionSettings.paused) {
      return;
    }

    if (mode === 'navigation' && frozenNavMap) {
      setDisplayMapData(frozenNavMap);
    } else if (mapData) {
      setDisplayMapData(mapData);
    }

    if (actualPose) {
      setDisplayPose(actualPose);
    }
  }, [actualPose, frozenNavMap, mapData, mode, subscriptionSettings.paused]);

  useEffect(() => {
    if (!displayMapData) {
      mapRasterRef.current = null;
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = displayMapData.info.width;
    offscreen.height = displayMapData.info.height;

    const offscreenCtx = offscreen.getContext('2d');
    if (!offscreenCtx) {
      mapRasterRef.current = null;
      return;
    }

    const image = offscreenCtx.createImageData(offscreen.width, offscreen.height);
    const pixels = image.data;

    for (let i = 0; i < displayMapData.data.length; i++) {
      const value = displayMapData.data[i];
      const offset = i * 4;

      let channel = 176;
      if (value >= 65) {
        channel = 30;
      } else if (value <= 30 && value !== -1) {
        channel = 240;
      }

      pixels[offset] = channel;
      pixels[offset + 1] = channel;
      pixels[offset + 2] = channel;
      pixels[offset + 3] = 255;
    }

    offscreenCtx.putImageData(image, 0, 0);
    mapRasterRef.current = offscreen;
  }, [displayMapData]);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) {
        return;
      }

      const { clientWidth, clientHeight } = containerRef.current;
      setCanvasSize({ width: clientWidth, height: clientHeight });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const worldToScreen = useCallback(
    (x: number, y: number) => ({
      x: view.offsetX - x * view.scale,
      y: view.offsetY + y * view.scale,
    }),
    [view.offsetX, view.offsetY, view.scale]
  );

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => ({
      x: (view.offsetX - screenX) / view.scale,
      y: (screenY - view.offsetY) / view.scale,
    }),
    [view.offsetX, view.offsetY, view.scale]
  );

  const computeTheta = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => Math.atan2(endY - startY, endX - startX),
    []
  );

  const createPose = useCallback(
    (x: number, y: number, theta: number): NavigationPose => ({
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `pose-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      x,
      y,
      theta,
    }),
    []
  );

  const drawMapLayer = useCallback(() => {
    const canvas = mapLayerRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    if (!displayMapData) {
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isConnected ? '正在等待地图数据...' : '尚未连接 ROS', width / 2, height / 2);
      return;
    }

    const { info } = displayMapData;

    if (layers.map) {
      const cachedMap = mapRasterRef.current;
      if (cachedMap) {
        const drawX = view.offsetX - info.origin.position.x * view.scale + info.resolution * view.scale;
        const drawY = view.offsetY + info.origin.position.y * view.scale;
        const drawWidth = info.width * info.resolution * view.scale;
        const drawHeight = info.height * info.resolution * view.scale;

        ctx.imageSmoothingEnabled = false;
        // Keep the cached raster aligned with the original per-cell renderer:
        // OccupancyGrid cells grow toward negative screen X in this view transform.
        ctx.drawImage(cachedMap, drawX, drawY, -drawWidth, drawHeight);
      }

      const origin = worldToScreen(info.origin.position.x, info.origin.position.y);
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '12px sans-serif';
      ctx.fillText('原点', origin.x + 8, origin.y - 8);
    }
  }, [canvasSize, displayMapData, isConnected, layers.map, view.offsetX, view.offsetY, view.scale, worldToScreen]);

  const drawPathLayer = useCallback(() => {
    const canvas = pathLayerRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);

    if (!displayMapData) {
      return;
    }

    if (layers.globalPlan && globalPath && globalPath.points.length > 0) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.beginPath();

      globalPath.points.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        if (index === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      });

      ctx.stroke();
    }

    if (layers.localPlan && localPath && localPath.points.length > 0) {
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.beginPath();

      localPath.points.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        if (index === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      });

      ctx.stroke();
    }

    if (mode === 'navigation' && navigationPoints.length > 0) {
      ctx.strokeStyle = navigationTaskMode === 'loop' ? '#f97316' : '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();

      navigationPoints.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        if (index === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      });

      if (navigationTaskMode === 'loop' && navigationPoints.length > 1) {
        const first = worldToScreen(navigationPoints[0].x, navigationPoints[0].y);
        ctx.lineTo(first.x, first.y);
      }

      ctx.stroke();

      navigationPoints.forEach((point, index) => {
        const screen = worldToScreen(point.x, point.y);
        const markerColor = navigationTaskMode === 'loop' ? '#f97316' : '#2563eb';

        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), screen.x, screen.y + 0.5);
      });

      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }, [
    canvasSize,
    displayMapData,
    globalPath,
    layers.globalPlan,
    layers.localPlan,
    localPath,
    mode,
    navigationPoints,
    navigationTaskMode,
    worldToScreen,
  ]);

  const drawLiveLayer = useCallback(() => {
    const canvas = liveLayerRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);

    if (!displayMapData) {
      return;
    }

    if (layers.scan && scanData && displayPose) {
      ctx.fillStyle = '#38bdf8';

      const robotYaw = displayPose.theta;
      const cosYaw = Math.cos(robotYaw);
      const sinYaw = Math.sin(robotYaw);
      const step = Math.max(1, Math.ceil(scanData.ranges.length / MAX_SCAN_POINTS));

      for (let i = 0; i < scanData.ranges.length; i += step) {
        const range = scanData.ranges[i];
        if (!Number.isFinite(range) || range < scanData.rangeMin || range > scanData.rangeMax) {
          continue;
        }

        const angle = scanData.angleMin + i * scanData.angleIncrement;
        const localX = range * Math.cos(angle);
        const localY = range * Math.sin(angle);
        const worldX = displayPose.x + cosYaw * localX - sinYaw * localY;
        const worldY = displayPose.y + sinYaw * localX + cosYaw * localY;
        const screen = worldToScreen(worldX, worldY);

        if (screen.x < 0 || screen.x >= width || screen.y < 0 || screen.y >= height) {
          continue;
        }

        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (layers.tf && displayPose) {
      const robot = worldToScreen(displayPose.x, displayPose.y);

      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(robot.x, robot.y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.beginPath();

      const arrowLength = 15;
      const arrowAngle = -displayPose.theta;

      ctx.moveTo(robot.x, robot.y);
      ctx.lineTo(robot.x + Math.cos(arrowAngle) * arrowLength, robot.y + Math.sin(arrowAngle) * arrowLength);
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      ctx.font = '12px sans-serif';
      ctx.fillText('机器人', robot.x + 12, robot.y - 12);
    }

    if (navDrag) {
      const start = worldToScreen(navDrag.startWorldX, navDrag.startWorldY);
      const end = worldToScreen(navDrag.currentWorldX, navDrag.currentWorldY);

      const color =
        navDrag.mode === 'initial_pose'
          ? '#3b82f6'
          : navDrag.mode === 'waypoint'
            ? '#f97316'
            : '#ef4444';

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLength = 12;

      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = '12px sans-serif';
      ctx.fillText(
        navDrag.mode === 'initial_pose' ? '初始位姿' : navDrag.mode === 'waypoint' ? '途经点' : '目标点',
        start.x + 10,
        start.y - 10
      );
    }
  }, [canvasSize, displayMapData, displayPose, layers.scan, layers.tf, navDrag, scanData, worldToScreen]);

  useLayoutEffect(() => {
    drawMapLayer();
  }, [drawMapLayer]);

  useLayoutEffect(() => {
    drawPathLayer();
  }, [drawPathLayer]);

  useLayoutEffect(() => {
    drawLiveLayer();
  }, [drawLiveLayer]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    setView(prev => ({
      ...prev,
      scale: Math.max(5, Math.min(200, prev.scale * delta)),
    }));
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = interactionLayerRef.current;
      if (!canvas) {
        return;
      }

      if (mode === 'navigation' && displayMapData && navClickMode !== 'none') {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const { x: startWorldX, y: startWorldY } = screenToWorld(clickX, clickY);

        setNavDrag({
          startWorldX,
          startWorldY,
          currentWorldX: startWorldX,
          currentWorldY: startWorldY,
          mode: navClickMode,
        });

        const handleMouseMove = (moveEvent: MouseEvent) => {
          const moveRect = canvas.getBoundingClientRect();
          const moveX = moveEvent.clientX - moveRect.left;
          const moveY = moveEvent.clientY - moveRect.top;
          const { x: currentWorldX, y: currentWorldY } = screenToWorld(moveX, moveY);

          setNavDrag(prev =>
            prev
              ? {
                  ...prev,
                  currentWorldX,
                  currentWorldY,
                }
              : prev
          );
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
          const upRect = canvas.getBoundingClientRect();
          const upX = upEvent.clientX - upRect.left;
          const upY = upEvent.clientY - upRect.top;
          const { x: endWorldX, y: endWorldY } = screenToWorld(upX, upY);
          const theta = computeTheta(startWorldX, startWorldY, endWorldX, endWorldY);

          if (navClickMode === 'goal') {
            const pose = createPose(startWorldX, startWorldY, theta);
            if (onGoalPoseSelected) {
              onGoalPoseSelected(pose);
            } else {
              publishGoal(startWorldX, startWorldY, theta);
            }
          } else if (navClickMode === 'waypoint') {
            onWaypointAdded?.(createPose(startWorldX, startWorldY, theta));
          } else if (navClickMode === 'initial_pose') {
            publishInitialPose(startWorldX, startWorldY, theta);
          }

          setNavDrag(null);
          setNavClickMode?.('none');
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return;
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const startView = { ...view };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        setView(prev => ({
          ...prev,
          offsetX: startView.offsetX + (moveEvent.clientX - startX),
          offsetY: startView.offsetY + (moveEvent.clientY - startY),
        }));
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [
      computeTheta,
      createPose,
      displayMapData,
      mode,
      navClickMode,
      onGoalPoseSelected,
      onWaypointAdded,
      publishGoal,
      publishInitialPose,
      screenToWorld,
      setNavClickMode,
      view,
    ]
  );

  const overlayMap = displayMapData;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-gray-900">
      <canvas ref={mapLayerRef} width={canvasSize.width} height={canvasSize.height} className="absolute inset-0 h-full w-full pointer-events-none" />
      <canvas ref={pathLayerRef} width={canvasSize.width} height={canvasSize.height} className="absolute inset-0 h-full w-full pointer-events-none" />
      <canvas ref={liveLayerRef} width={canvasSize.width} height={canvasSize.height} className="absolute inset-0 h-full w-full pointer-events-none" />
      <canvas
        ref={interactionLayerRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        className={`absolute inset-0 h-full w-full ${navClickMode !== 'none' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {overlayMap && (
        <div className="absolute bottom-4 left-4 rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div>分辨率：{overlayMap.info.resolution.toFixed(3)} m/cell</div>
          <div>尺寸：{overlayMap.info.width} x {overlayMap.info.height}</div>
          <div>缩放：{view.scale.toFixed(1)} px/m</div>
          <div>模式：{mode === 'navigation' ? '冻结首帧 /map' : '实时 /map'}</div>
          {mode === 'navigation' && navigationPoints.length > 0 && <div>导航点：{navigationPoints.length} 个</div>}
        </div>
      )}

      <div className="absolute right-4 top-4 space-y-1 rounded bg-black/70 px-3 py-2 text-xs text-white">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border border-gray-600 bg-white"></div>
          <span>空闲 (0)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border border-gray-600 bg-gray-500"></div>
          <span>未知 (-1)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border border-gray-600 bg-gray-900"></div>
          <span>占用 (100)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded-full bg-green-500"></div>
          <span>机器人</span>
        </div>
      </div>
    </div>
  );
}
