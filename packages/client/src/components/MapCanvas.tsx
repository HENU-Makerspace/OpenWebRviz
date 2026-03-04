import { useEffect, useRef, useState, useCallback } from 'react';
import * as ROSLIB from 'roslib';
import { useRosMap, useRosTf, MapData, RobotPose } from '../hooks/useRosMap';
import { useRosLaserScan, LaserPoint } from '../hooks/useRosLaserScan';
import { useLayers } from './LayerControl';

interface MapCanvasProps {
  ros: ROSLIB.Ros | null;
  isConnected: boolean;
  mapTopic?: string;
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
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ scale: 50, offsetX: 0, offsetY: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // Get subscription settings first
  const { layers, subscriptionSettings } = useLayers();
  const isPaused = subscriptionSettings.paused;

  const { mapData, robotPose, isMapLoaded, setRobotPose } = useRosMap(ros, mapTopic, isPaused);
  const tfPose = useRosTf(ros, 'map', 'base_link', isPaused);
  const { laserPoints, isScanReceived } = useRosLaserScan(ros, '/scan', isPaused);

  // Combine TF pose with map-derived pose
  const actualPose = tfPose || robotPose;

  // Display data with rate limiting and pause control
  const [displayMapData, setDisplayMapData] = useState<MapData | null>(null);
  const [displayPose, setDisplayPose] = useState<{ x: number; y: number; theta: number } | null>(null);
  const [displayLaserPoints, setDisplayLaserPoints] = useState<LaserPoint[]>([]);

  // Refs for rate limiting
  const lastMapUpdate = useRef(0);
  const lastPoseUpdate = useRef(0);
  const lastLaserUpdate = useRef(0);

  // Update display data based on settings
  useEffect(() => {
    const { rate, paused } = subscriptionSettings;
    const now = performance.now();
    const minInterval = rate > 0 ? 1000 / rate : 0;

    // Always update if not paused (rate limiting handles throttling)
    if (!paused) {
      // Update map data
      if (mapData && (rate === 0 || now - lastMapUpdate.current >= minInterval)) {
        setDisplayMapData(mapData);
        lastMapUpdate.current = now;
      }

      // Update pose data
      if (actualPose && (rate === 0 || now - lastPoseUpdate.current >= minInterval)) {
        setDisplayPose(actualPose);
        lastPoseUpdate.current = now;
      }

      // Update laser data
      if (laserPoints.length > 0 && (rate === 0 || now - lastLaserUpdate.current >= minInterval)) {
        setDisplayLaserPoints(laserPoints);
        lastLaserUpdate.current = now;
      }
    }
  }, [mapData, actualPose, laserPoints, subscriptionSettings]);

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

    // Center the view on the origin (0,0 in map coordinates)
    const centerX = width / 2 + view.offsetX;
    const centerY = height / 2 + view.offsetY;

    // Calculate cell size in pixels
    const cellPixelSize = Math.max(1, Math.round(cellSize / resolution));

    // Draw map using fillRect with bounds checking
    if (layers.map) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const idx = y * mapWidth + x;
          const value = data[idx];

          // Calculate screen position
          const worldX = originX + x * resolution;
          const worldY = originY + (mapHeight - 1 - y) * resolution;
          const screenX = centerX + worldX * cellSize;
          const screenY = centerY - worldY * cellSize;

          // Skip if outside canvas (with margin for cell size)
          const margin = cellPixelSize;
          if (screenX < -margin || screenX >= width + margin ||
              screenY < -margin || screenY >= height + margin) {
            continue;
          }

          // Determine color
          let color: string;
          if (value === -1) {
            color = '#b0b0b0'; // unknown = gray
          } else if (value === 100) {
            color = '#1e1e1e'; // occupied = dark
          } else {
            color = '#f0f0f0'; // free = white
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
        const screenY = centerY - gy * cellSize;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(width, screenY);
        ctx.stroke();
      }
    }

    // Draw robot pose if available
    if (displayPose && layers.tf) {
      const robotScreenX = centerX + displayPose.x * cellSize;
      const robotScreenY = centerY - displayPose.y * cellSize; // Flip Y

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

    // Draw laser scan points
    if (layers.laser && displayLaserPoints.length > 0 && displayPose) {
      const robotScreenX = centerX + displayPose.x * cellSize;
      const robotScreenY = centerY - displayPose.y * cellSize;

      ctx.fillStyle = '#ef4444';
      const pointSize = Math.max(1, cellSize / 20);

      for (const point of displayLaserPoints) {
        // Transform point from laser frame to map frame using robot pose
        // Laser is at robot position, so we just add robot position
        const mapX = displayPose.x + point.x;
        const mapY = displayPose.y + point.y;

        const screenX = centerX + mapX * cellSize;
        const screenY = centerY - mapY * cellSize;

        ctx.beginPath();
        ctx.arc(screenX, screenY, pointSize, 0, Math.PI * 2);
        ctx.fill();
      }
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

  }, [displayMapData, displayPose, displayLaserPoints, canvasSize, view, isConnected, layers, isScanReceived]);

  // Optimized: Only render when data changes, not on every frame
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const [renderKey, setRenderKey] = useState(0);

  // Trigger render when any data changes - use individual layer values
  useEffect(() => {
    setRenderKey(k => k + 1);
  }, [displayMapData, displayPose, displayLaserPoints, canvasSize, view, isConnected, layers.map, layers.tf, layers.laser]);

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
  }, [view]);

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
        className="cursor-grab active:cursor-grabbing"
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
        {isScanReceived && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500"></div>
            <span>Laser ({displayLaserPoints.length} pts)</span>
          </div>
        )}
      </div>
    </div>
  );
}
