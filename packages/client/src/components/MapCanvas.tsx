import { useEffect, useRef, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRosMap, MapData } from '../hooks/useRosMap';
import { useRosTfTree } from '../hooks/useRosTf';
import { useRosPath, useGoalPublisher, useInitialPosePublisher } from '../hooks/useRosPath';
import type { NavigationPose, NavigationTaskMode } from '../hooks/useNavigationTasks';
import { useLayers } from './LayerControl';
import { useMode } from '../hooks/useMode';
import { useRosScan } from '../hooks/useRosScan';

interface MapCanvasProps {
  ros: ROSLIB.Ros | null;
  isConnected: boolean;
  mapTopic?: string;
  navClickMode?: 'none' | 'initial_pose' | 'goal' | 'waypoint';
  setNavClickMode?: (mode: 'none' | 'initial_pose' | 'goal' | 'waypoint') => void;
  selectedMap?: string | null;
  navigationTaskMode?: NavigationTaskMode;
  navigationPoints?: NavigationPose[];
  onGoalPoseSelected?: (pose: NavigationPose) => void;
  onWaypointAdded?: (pose: NavigationPose) => void;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function MapCanvas({
  ros,
  isConnected,
  mapTopic = '/map',
  navClickMode = 'none',
  setNavClickMode,
  selectedMap = null,
  navigationTaskMode = 'single',
  navigationPoints = [],
  onGoalPoseSelected,
  onWaypointAdded,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  const isPaused = subscriptionSettings.paused;
  const { mode } = useMode();

  const mapPaused = isPaused || !layers.map;
  const tfPaused = isPaused || !layers.tf;
  const pathPaused = isPaused || (!layers.globalPlan && !layers.localPlan);

  // 始终订阅 /map，不再使用本地静态地图文件
  const { mapData, robotPose } = useRosMap(ros, mapTopic, mapPaused);
  const { robotPose: tfPose } = useRosTfTree(ros, tfPaused);
  const { globalPath, localPath } = useRosPath(ros, '/plan', '/local_plan', pathPaused);
  const { publishGoal } = useGoalPublisher(ros, '/goal_pose');
  const { publishInitialPose } = useInitialPosePublisher(ros, '/initialpose');

  const actualPose = tfPose || robotPose;

  const [frozenNavMap, setFrozenNavMap] = useState<MapData | null>(null);
  const [displayMapData, setDisplayMapData] = useState<MapData | null>(null);
  const [displayPose, setDisplayPose] = useState<{ x: number; y: number; theta: number } | null>(null);
  
  const scanPaused = isPaused || !layers.scan;
  const { scanData } = useRosScan(ros, '/scan', scanPaused);
  // 进入导航模式后，锁定第一次收到的 /map
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
    const { paused } = subscriptionSettings;
    if (!paused) {
      if (mode === 'navigation' && frozenNavMap) {
        setDisplayMapData(frozenNavMap);
      } else if (mapData) {
        setDisplayMapData(mapData);
      }

      if (actualPose) {
        setDisplayPose(actualPose);
      }
    }
  }, [mode, mapData, frozenNavMap, actualPose, subscriptionSettings.paused]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setCanvasSize({ width: clientWidth, height: clientHeight });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // 统一使用一套坐标变换，不再区分静态图/动态图
  const worldToScreen = useCallback(
    (x: number, y: number) => {
      const scale = view.scale;
      return {
        x: view.offsetX - x * scale,
        y: view.offsetY + y * scale,
      };
    },
    [view.offsetX, view.offsetY, view.scale]
  );

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const scale = view.scale;
      return {
        x: (view.offsetX - screenX) / scale,
        y: (screenY - view.offsetY) / scale,
      };
    },
    [view.offsetX, view.offsetY, view.scale]
  );

  const computeTheta = useCallback(
    (startX: number, startY: number, endX: number, endY: number) => {
      return Math.atan2(endY - startY, endX - startX);
    },
    []
  );

  const createPose = useCallback((x: number, y: number, theta: number): NavigationPose => ({
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pose-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    x,
    y,
    theta,
  }), []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvasSize;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    if (!displayMapData) {
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        isConnected ? '正在等待地图数据...' : '尚未连接 ROS',
        width / 2,
        height / 2
      );
      return;
    }

    const { info, data } = displayMapData;
    const resolution = info.resolution;
    const mapWidth = info.width;
    const mapHeight = info.height;
    const originX = info.origin.position.x;
    const originY = info.origin.position.y;
    const cellPixelSize = Math.ceil(view.scale * resolution) + 1;

    if (layers.map) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const idx = y * mapWidth + x;
          const value = data[idx];

          const worldX = originX + x * resolution;
          const worldY = originY + y * resolution;
          const { x: screenX, y: screenY } = worldToScreen(worldX, worldY);

          const margin = cellPixelSize;
          if (
            screenX < -margin ||
            screenX >= width + margin ||
            screenY < -margin ||
            screenY >= height + margin
          ) {
            continue;
          }

          let color: string;
          if (value === -1) {
            color = '#b0b0b0';
          } else if (value >= 65) {
            color = '#1e1e1e';
          } else if (value <= 30) {
            color = '#f0f0f0';
          } else {
            color = '#b0b0b0';
          }

          ctx.fillStyle = color;
          ctx.fillRect(screenX, screenY, cellPixelSize, cellPixelSize);
        }
      }
    }

    if (displayPose && layers.tf) {
      const { x: robotScreenX, y: robotScreenY } = worldToScreen(displayPose.x, displayPose.y);

      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(robotScreenX, robotScreenY, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.beginPath();

      const arrowLength = 15;
      const arrowAngle = -displayPose.theta;

      ctx.moveTo(robotScreenX, robotScreenY);
      ctx.lineTo(
        robotScreenX + Math.cos(arrowAngle) * arrowLength,
        robotScreenY + Math.sin(arrowAngle) * arrowLength
      );
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      ctx.font = '12px sans-serif';
      ctx.fillText('机器人', robotScreenX + 12, robotScreenY - 12);
    }

    if (layers.globalPlan && globalPath && globalPath.points.length > 0) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.beginPath();

      for (let i = 0; i < globalPath.points.length; i++) {
        const point = globalPath.points[i];
        const { x, y } = worldToScreen(point.x, point.y);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    }

    if (layers.localPlan && localPath && localPath.points.length > 0) {
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.beginPath();

      for (let i = 0; i < localPath.points.length; i++) {
        const point = localPath.points[i];
        const { x, y } = worldToScreen(point.x, point.y);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    }
    if (scanData && displayPose) {
      ctx.fillStyle = '#38bdf8';

      const robotYaw = displayPose.theta;
      const cosYaw = Math.cos(robotYaw);
      const sinYaw = Math.sin(robotYaw);

      for (let i = 0; i < scanData.ranges.length; i++) {
        const range = scanData.ranges[i];

        if (
          !Number.isFinite(range) ||
          range < scanData.rangeMin ||
          range > scanData.rangeMax
        ) {
          continue;
        }

        const angle = scanData.angleMin + i * scanData.angleIncrement;

        // 激光点在雷达/机器人局部坐标系下
        const localX = range * Math.cos(angle);
        const localY = range * Math.sin(angle);

        // 变换到地图坐标系
        const worldX = displayPose.x + cosYaw * localX - sinYaw * localY;
        const worldY = displayPose.y + sinYaw * localX + cosYaw * localY;

        const { x: screenX, y: screenY } = worldToScreen(worldX, worldY);

        if (
          screenX < 0 ||
          screenX >= width ||
          screenY < 0 ||
          screenY >= height
        ) {
          continue;
        }

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (layers.map) {
      const { x: originMarkerX, y: originMarkerY } = worldToScreen(
        info.origin.position.x,
        info.origin.position.y
      );

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(originMarkerX, originMarkerY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '12px sans-serif';
      ctx.fillText('原点', originMarkerX + 8, originMarkerY - 8);
    }

    if (mode === 'navigation' && navigationPoints.length > 0) {
      ctx.strokeStyle = navigationTaskMode === 'loop' ? '#f97316' : '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();

      navigationPoints.forEach((point, index) => {
        const screenPoint = worldToScreen(point.x, point.y);
        if (index === 0) {
          ctx.moveTo(screenPoint.x, screenPoint.y);
        } else {
          ctx.lineTo(screenPoint.x, screenPoint.y);
        }
      });

      if (navigationTaskMode === 'loop' && navigationPoints.length > 1) {
        const firstPoint = worldToScreen(navigationPoints[0].x, navigationPoints[0].y);
        ctx.lineTo(firstPoint.x, firstPoint.y);
      }

      ctx.stroke();

      navigationPoints.forEach((point, index) => {
        const screenPoint = worldToScreen(point.x, point.y);
        const markerColor = navigationTaskMode === 'loop' ? '#f97316' : '#2563eb';

        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.arc(screenPoint.x, screenPoint.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), screenPoint.x, screenPoint.y + 0.5);
      });

      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
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

      // 起点圆
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // 主箭头线
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      // 箭头头部
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLength = 12;

      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle - Math.PI / 6),
        end.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle + Math.PI / 6),
        end.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();

      // 标签
      ctx.fillStyle = color;
      ctx.font = '12px sans-serif';
      ctx.fillText(
        navDrag.mode === 'initial_pose'
          ? '初始位姿'
          : navDrag.mode === 'waypoint'
            ? '途经点'
            : '目标点',
        start.x + 10,
        start.y - 10
      );
    }
  }, [
    canvasSize,
    displayMapData,
    displayPose,
    globalPath,
    isConnected,
    layers.globalPlan,
    layers.localPlan,
    layers.map,
    layers.tf,
    localPath,
    view.scale,
    worldToScreen,
    navDrag,
    navigationPoints,
    navigationTaskMode,
    onGoalPoseSelected,
    onWaypointAdded,
    scanData,
    createPose,
  ]);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    setRenderKey(k => k + 1);
  }, [
    displayMapData,
    displayPose,
    canvasSize,
    view,
    isConnected,
    layers.map,
    layers.tf,
    layers.globalPlan,
    layers.localPlan,
    globalPath,
    localPath,
    navDrag,
    scanData,
  ]);

  useEffect(() => {
    drawRef.current();
  }, [renderKey]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    setView(prev => ({
      ...prev,
      scale: Math.max(5, Math.min(200, prev.scale * delta)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
if (mode === 'navigation' && displayMapData && navClickMode !== 'none') {
  const canvas = canvasRef.current;
  if (!canvas) return;

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
  }, [
    mode,
    displayMapData,
    navClickMode,
    screenToWorld,
    publishGoal,
    publishInitialPose,
    setNavClickMode,
    view,
    createPose,
    onGoalPoseSelected,
    onWaypointAdded,
  ]);

  const overlayMap = displayMapData;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative bg-gray-900"
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        className={`cursor-grab active:cursor-grabbing ${navClickMode !== 'none' ? 'cursor-crosshair' : ''}`}
      />

      {overlayMap && (
        <div className="absolute bottom-4 left-4 bg-black/70 text-white px-3 py-2 rounded text-xs">
          <div>分辨率：{overlayMap.info.resolution.toFixed(3)} m/cell</div>
          <div>尺寸：{overlayMap.info.width} x {overlayMap.info.height}</div>
          <div>缩放：{view.scale.toFixed(1)} px/m</div>
          <div>模式：{mode === 'navigation' ? '冻结首帧 /map' : '实时 /map'}</div>
          {mode === 'navigation' && navigationPoints.length > 0 && (
            <div>导航点：{navigationPoints.length} 个</div>
          )}
        </div>
      )}

      <div className="absolute top-4 right-4 bg-black/70 text-white px-3 py-2 rounded text-xs space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white border border-gray-600"></div>
          <span>空闲 (0)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-500 border border-gray-600"></div>
          <span>未知 (-1)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-900 border border-gray-600"></div>
          <span>占用 (100)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-500"></div>
          <span>机器人</span>
        </div>
      </div>
    </div>
  );
}
