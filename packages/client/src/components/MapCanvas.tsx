import { useEffect, useRef, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRosMap, MapData } from '../hooks/useRosMap';
import { useRosTfTree } from '../hooks/useRosTf';
import { useRosPath, useGoalPublisher, useInitialPosePublisher } from '../hooks/useRosPath';
import { useLayers } from './LayerControl';
import { useMode } from '../hooks/useMode';

interface MapCanvasProps {
  ros: ROSLIB.Ros | null;
  isConnected: boolean;
  mapTopic?: string;
  navClickMode?: 'none' | 'initial_pose' | 'goal';
  setNavClickMode?: (mode: 'none' | 'initial_pose' | 'goal') => void;
  selectedMap?: string | null;
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
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ scale: 50, offsetX: 0, offsetY: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const { layers, subscriptionSettings } = useLayers();
  const isPaused = subscriptionSettings.paused;
  const { mode } = useMode();

  const mapPaused = isPaused || !layers.map;
  const tfPaused = isPaused || !layers.tf;
  const pathPaused = isPaused || (!layers.globalPlan && !layers.localPlan);

  const useStaticMap = mode === 'navigation' && !!selectedMap;

  const { mapData, robotPose } = useRosMap(
    ros,
    useStaticMap ? null : mapTopic,
    mapPaused
  );
  const { robotPose: tfPose } = useRosTfTree(ros, tfPaused);
  const { globalPath, localPath } = useRosPath(ros, '/plan', '/local_plan', pathPaused);
  const { publishGoal } = useGoalPublisher(ros, '/goal_pose');
  const { publishInitialPose } = useInitialPosePublisher(ros, '/initialpose');

  const [staticMapData, setStaticMapData] = useState<MapData | null>(null);
  const [displayMapData, setDisplayMapData] = useState<MapData | null>(null);
  const [displayPose, setDisplayPose] = useState<{ x: number; y: number; theta: number } | null>(null);
  const [isStaticMap, setIsStaticMap] = useState(false);

  useEffect(() => {
    if (mode === 'navigation' && selectedMap) {
      fetch(`http://localhost:4001/api/maps/${selectedMap}/data`)
        .then(res => res.json())
        .then(data => {
          if (!data.error) {
            setStaticMapData(data);
          }
        })
        .catch(err => console.error('Failed to load static map:', err));
    } else {
      setStaticMapData(null);
    }
  }, [mode, selectedMap]);

  const actualPose = tfPose || robotPose;

  useEffect(() => {
    const { paused } = subscriptionSettings;
    if (!paused) {
      if (staticMapData) {
        setDisplayMapData(staticMapData);
        setIsStaticMap(true);
      } else if (mapData) {
        setDisplayMapData(mapData);
        setIsStaticMap(false);
      }

      if (actualPose) {
        const correctedPose = normalizeStaticNavPoint(actualPose.x, actualPose.y);
        setDisplayPose({
          x: correctedPose.x,
          y: correctedPose.y,
          theta: actualPose.theta,
        });
      }
    }
  }, [mapData, staticMapData, actualPose, subscriptionSettings.paused]);

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

  /**
   * 统一坐标变换：
   *
   * 静态地图（navigation）：
   *   X 向右增加，Y 向上增加 -> screenY 需要取反
   *
   * 动态地图（mapping）：
   *   保持你原来“建图没 bug”的表现：
   *   X 仍然沿用原来的反向，Y 仍然沿用原来的正向
   *
   * 重点不是哪套“物理上最优雅”，而是整个文件必须只用一套。
   */
const worldToScreen = useCallback(
  (x: number, y: number) => {
    const scale = view.scale;

    if (isStaticMap) {
      return {
        x: view.offsetX + x * scale,
        y: view.offsetY - y * scale,
      };
    }

    return {
      x: view.offsetX - x * scale,
      y: view.offsetY + y * scale,
    };
  },
  [view.offsetX, view.offsetY, view.scale, isStaticMap]
);

const screenToWorld = useCallback(
  (screenX: number, screenY: number) => {
    const scale = view.scale;

    if (isStaticMap) {
      return {
        x: (screenX - view.offsetX) / scale,
        y: (view.offsetY - screenY) / scale,
      };
    }

    return {
      x: (view.offsetX - screenX) / scale,
      y: (screenY - view.offsetY) / scale,
    };
  },
  [view.offsetX, view.offsetY, view.scale, isStaticMap]
);

const normalizeStaticNavPoint = useCallback(
  (x: number, y: number) => {
    if (!isStaticMap) {
      return { x, y };
    }
    return { x: y, y: x };
  },
  [isStaticMap]
);

const denormalizeStaticNavPoint = useCallback(
  (x: number, y: number) => {
    if (!isStaticMap) {
      return { x, y };
    }
    return { x: y, y: x };
  },
  [isStaticMap]
);

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
        isConnected ? 'Waiting for map data...' : 'Not connected to ROS',
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

          const freeThreshold = isStaticMap ? 15 : 30;
          let color: string;

          if (value === -1) {
            color = '#b0b0b0';
          } else if (value >= 65) {
            color = '#1e1e1e';
          } else if (value <= freeThreshold) {
            color = '#f0f0f0';
          } else {
            color = '#b0b0b0';
          }

          ctx.fillStyle = color;

          if (isStaticMap) {
            // 静态图时 worldToScreen 给的是“世界点”，canvas 的 fillRect 以左上角为锚点
            ctx.fillRect(screenX, screenY - cellPixelSize, cellPixelSize, cellPixelSize);
          } else {
            ctx.fillRect(screenX, screenY, cellPixelSize, cellPixelSize);
          }
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
      const cosT = Math.cos(displayPose.theta);
      const sinT = Math.sin(displayPose.theta);

      const dirX = isStaticMap ? cosT : -cosT;
      const dirY = isStaticMap ? -sinT : sinT;

      ctx.moveTo(robotScreenX, robotScreenY);
      ctx.lineTo(
        robotScreenX + dirX * arrowLength,
        robotScreenY + dirY * arrowLength
      );
      ctx.stroke();

      ctx.fillStyle = '#22c55e';
      ctx.font = '12px sans-serif';
      ctx.fillText('base_link', robotScreenX + 12, robotScreenY - 12);
    }

    if (layers.globalPlan && globalPath && globalPath.points.length > 0) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.beginPath();

      for (let i = 0; i < globalPath.points.length; i++) {
        const point = globalPath.points[i];
        const correctedPoint = normalizeStaticNavPoint(point.x, point.y);
        const { x, y } = worldToScreen(correctedPoint.x, correctedPoint.y);

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
      ctx.fillText('origin', originMarkerX + 8, originMarkerY - 8);
    }
  }, [
    canvasSize,
    displayMapData,
    displayPose,
    globalPath,
    isConnected,
    isStaticMap,
    layers.globalPlan,
    layers.localPlan,
    layers.map,
    layers.tf,
    localPath,
    view.scale,
    worldToScreen,
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
    isStaticMap,
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

      const { x: worldX, y: worldY } = screenToWorld(clickX, clickY);

      console.log(
        '[MapCanvas] navClickMode:',
        navClickMode,
        'worldX:',
        worldX,
        'worldY:',
        worldY,
        'isStaticMap:',
        isStaticMap
      );

      const { x: rawWorldX, y: rawWorldY } = screenToWorld(clickX, clickY);
      const correctedWorld = denormalizeStaticNavPoint(rawWorldX, rawWorldY);

      if (navClickMode === 'goal') {
        publishGoal(correctedWorld.x, correctedWorld.y, 0);
      } else if (navClickMode === 'initial_pose') {
        publishInitialPose(correctedWorld.x, correctedWorld.y, 0);
      }

      setNavClickMode?.('none');
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
    isStaticMap,
    publishGoal,
    publishInitialPose,
    setNavClickMode,
    view,
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
          <div>Resolution: {overlayMap.info.resolution.toFixed(3)} m/cell</div>
          <div>Size: {overlayMap.info.width} x {overlayMap.info.height}</div>
          <div>Scale: {view.scale.toFixed(1)} px/m</div>
          <div>Mode: {isStaticMap ? 'Static map' : 'ROS map'}</div>
        </div>
      )}

      <div className="absolute top-4 right-4 bg-black/70 text-white px-3 py-2 rounded text-xs space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white border border-gray-600"></div>
          <span>Free (0)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-500 border border-gray-600"></div>
          <span>Unknown (-1)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-900 border border-gray-600"></div>
          <span>Occupied (100)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-500"></div>
          <span>Robot</span>
        </div>
      </div>
    </div>
  );
}