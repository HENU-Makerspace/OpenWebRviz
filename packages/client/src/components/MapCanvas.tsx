import { useEffect, useRef, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRosMap, MapData, RobotPose } from '../hooks/useRosMap';
import { useRosTf, useRosTfTree } from '../hooks/useRosTf';
import { useRosPath, useGoalPublisher, useInitialPosePublisher } from '../hooks/useRosPath';
import { useLayers } from './LayerControl';
import { useMode } from '../hooks/useMode';

interface MapCanvasProps {
  ros: ROSLIB.Ros | null;
  isConnected: boolean;
  mapTopic?: string;
  navClickMode?: 'none' | 'initial_pose' | 'goal';
  setNavClickMode?: (mode: 'none' | 'initial_pose' | 'goal') => void;
  selectedMap?: string | null; // Static map name for navigation mode
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

  // Get subscription settings first
  const { layers, subscriptionSettings } = useLayers();
  const isPaused = subscriptionSettings.paused;
  const { mode } = useMode();

  // Pause based on both global pause and layer settings
  const mapPaused = isPaused || !layers.map;
  const tfPaused = isPaused || !layers.tf;
  const pathPaused = isPaused || (!layers.globalPlan && !layers.localPlan);

  // In navigation mode with a selected static map, don't subscribe to /map topic
  const useStaticMap = mode === 'navigation' && selectedMap;
  const { mapData, robotPose, isMapLoaded, setRobotPose } = useRosMap(
    ros,
    useStaticMap ? null : mapTopic,
    mapPaused
  );
  const { robotPose: tfPose } = useRosTfTree(ros, tfPaused);
  const { globalPath, localPath } = useRosPath(ros, '/plan', '/local_plan', pathPaused);
  const { publishGoal } = useGoalPublisher(ros, '/goal_pose');
  const { publishInitialPose } = useInitialPosePublisher(ros, '/initialpose');

  // Load static map data when in navigation mode with selected map
  const [staticMapData, setStaticMapData] = useState<MapData | null>(null);

  useEffect(() => {
    if (useStaticMap && selectedMap) {
      fetch(`http://localhost:4000/api/maps/${selectedMap}/data`)
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
  }, [useStaticMap, selectedMap]);

  // Combine TF pose with map-derived pose
  const actualPose = tfPose || robotPose;

  // Display data - directly use source data
  const [displayMapData, setDisplayMapData] = useState<MapData | null>(null);
  const [displayPose, setDisplayPose] = useState<{ x: number; y: number; theta: number } | null>(null);

  // Update display data when source data changes
  useEffect(() => {
    const { paused } = subscriptionSettings;
    if (!paused) {
      // Use static map in navigation mode, otherwise use ROS map
      if (staticMapData) {
        setDisplayMapData(staticMapData);
      } else if (mapData) {
        setDisplayMapData(mapData);
      }
      if (actualPose) setDisplayPose(actualPose);
    }
  }, [mapData, staticMapData, actualPose, subscriptionSettings.paused]);

  // Resize canvas to fit container
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

  // Draw map and robot
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvasSize;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    if (!displayMapData) {
      // Draw "No map data" message
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isConnected ? 'Waiting for map data...' : 'Not connected to ROS', width / 2, height / 2);
      return;
    }

    const { info, data } = displayMapData;
    const resolution = info.resolution;
    const mapWidth = info.width;
    const mapHeight = info.height;

    // Calculate view parameters
    const cellSize = view.scale; // pixels per meter

    // Map origin position (in meters)
    const originX = info.origin.position.x;
    const originY = info.origin.position.y;

    // Center the view at top-left corner (origin at 0,0)
    const centerX = view.offsetX;
    const centerY = view.offsetY;

    // Calculate cell size in pixels: pixels/meter * meters/cell = pixels/cell
    const cellPixelSize = Math.max(1, cellSize * resolution);

    // Draw map using fillRect with bounds checking
    if (layers.map) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const idx = y * mapWidth + x;
          const value = data[idx];

          // Calculate screen position
          const worldX = originX + x * resolution;
          const worldY = originY + y * resolution;
          const screenX = centerX + worldX * cellSize;
          const screenY = centerY + worldY * cellSize;

          // Skip if outside canvas (with margin for cell size)
          const margin = cellPixelSize;
          if (screenX < -margin || screenX >= width + margin ||
              screenY < -margin || screenY >= height + margin) {
            continue;
          }

          // Determine color using threshold
          let color: string;
           if (value >= 65) {
            color = '#1e1e1e'; // occupied (value >= 65) = dark
          } else if (value <= 10) {
            color = '#f0f0f0'; // free (value <= 30) = white
          } else {
            color = '#b0b0b0'; // uncertain = gray
          }

          ctx.fillStyle = color;
          ctx.fillRect(screenX, screenY, cellPixelSize, cellPixelSize);
        }
      }
    }

    // Draw grid lines (1 meter spacing)
    if (cellSize >= 10 && layers.map) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      const gridSize = 1.0; // 1 meter
      const gridPixelSize = gridSize * cellSize;

      // Draw grid lines relative to origin
      const startGridX = Math.floor(originX);
      const endGridX = Math.floor(originX + mapWidth * resolution);
      const startGridY = Math.floor(originY);
      const endGridY = Math.floor(originY + mapHeight * resolution);

      // Vertical lines
      for (let gx = Math.ceil(startGridX); gx <= endGridX; gx++) {
        const screenX = centerX + gx * cellSize;
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, height);
        ctx.stroke();
      }

      // Horizontal lines
      for (let gy = Math.ceil(startGridY); gy <= endGridY; gy++) {
        const screenY = centerY + gy * cellSize;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(width, screenY);
        ctx.stroke();
      }
    }

    // Draw robot pose if available
    if (displayPose && layers.tf) {
      const robotScreenX = centerX + displayPose.x * cellSize;
      const robotScreenY = centerY - displayPose.y * cellSize;

      // Robot body (circle)
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(robotScreenX, robotScreenY, 8, 0, Math.PI * 2);
      ctx.fill();

      // Robot direction arrow
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const arrowLength = 15;
      const arrowAngle = displayPose.theta;
      ctx.moveTo(robotScreenX, robotScreenY);
      ctx.lineTo(
        robotScreenX + Math.cos(-arrowAngle) * arrowLength,
        robotScreenY + Math.sin(-arrowAngle) * arrowLength
      );
      ctx.stroke();

      // Robot frame label
      ctx.fillStyle = '#22c55e';
      ctx.font = '12px sans-serif';
      ctx.fillText('base_link', robotScreenX + 12, robotScreenY - 12);
    }

    // Draw global path (purple)
    if (layers.globalPlan && globalPath && globalPath.points.length > 0) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < globalPath.points.length; i++) {
        const point = globalPath.points[i];
        const screenX = centerX + point.x * cellSize;
        const screenY = centerY + point.y * cellSize;
        if (i === 0) {
          ctx.moveTo(screenX, screenY);
        } else {
          ctx.lineTo(screenX, screenY);
        }
      }
      ctx.stroke();
    }

    // Draw local path (yellow)
    if (layers.localPlan && localPath && localPath.points.length > 0) {
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < localPath.points.length; i++) {
        const point = localPath.points[i];
        const screenX = centerX + point.x * cellSize;
        const screenY = centerY + point.y * cellSize;
        if (i === 0) {
          ctx.moveTo(screenX, screenY);
        } else {
          ctx.lineTo(screenX, screenY);
        }
      }
      ctx.stroke();
    }

    // Draw map origin marker
    if (layers.map) {
      const originMarkerX = centerX + info.origin.position.x * cellSize;
      const originMarkerY = centerY - info.origin.position.y * cellSize;

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(originMarkerX, originMarkerY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.font = '12px sans-serif';
      ctx.fillText('origin', originMarkerX + 8, originMarkerY - 8);
    }

  }, [displayMapData, displayPose, canvasSize, view, isConnected, layers, globalPath, localPath]);

  // Optimized: Only render when data changes, not on every frame
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const [renderKey, setRenderKey] = useState(0);

  // Trigger render when any data changes - use individual layer values
  useEffect(() => {
    setRenderKey(k => k + 1);
  }, [displayMapData, displayPose, canvasSize, view, isConnected, layers.map, layers.tf, layers.globalPlan, layers.localPlan, globalPath, localPath]);

  // Single render triggered by data changes
  useEffect(() => {
    drawRef.current();
  }, [renderKey]);

  // Pan handling
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setView(prev => ({
      ...prev,
      scale: Math.max(5, Math.min(200, prev.scale * delta)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // In navigation mode, click publishes goal or initial pose based on navClickMode
    if (mode === 'navigation' && mapData && displayMapData && navClickMode !== 'none') {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const { width, height } = canvasSize;
      const { info } = displayMapData;
      const resolution = info.resolution;
      const cellSize = view.scale;
      const originX = info.origin.position.x;
      const originY = info.origin.position.y;
      const centerX = view.offsetX;
      const centerY = view.offsetY;

      // Convert screen coordinates to world coordinates
      const worldX = (clickX - centerX) / cellSize - originX;
      const worldY = (clickY - centerY) / cellSize - originY;

      // Publish based on click mode
      if (navClickMode === 'goal') {
        publishGoal(worldX, worldY, 0);
      } else if (navClickMode === 'initial_pose') {
        publishInitialPose(worldX, worldY, 0);
      }

      // Reset click mode after publishing
      if (setNavClickMode) {
        setNavClickMode('none');
      }
      return;
    }

    // Otherwise, handle panning
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
  }, [view, mode, mapData, displayMapData, publishGoal]);

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

      {/* Map info overlay */}
      {mapData && (
        <div className="absolute bottom-4 left-4 bg-black/70 text-white px-3 py-2 rounded text-xs">
          <div>Resolution: {mapData.info.resolution.toFixed(3)} m/cell</div>
          <div>Size: {mapData.info.width} x {mapData.info.height}</div>
          <div>Scale: {view.scale.toFixed(1)} px/m</div>
        </div>
      )}

      {/* Legend */}
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
