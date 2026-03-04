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

  const { mapData, robotPose, isMapLoaded, setRobotPose } = useRosMap(ros, mapTopic);
  const tfPose = useRosTf(ros, 'map', 'base_link');
  const { laserPoints, isScanReceived } = useRosLaserScan(ros, '/scan');
  const { layers } = useLayers();

  // Combine TF pose with map-derived pose
  const actualPose = tfPose || robotPose;

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

    if (!mapData) {
      // Draw "No map data" message
      ctx.fillStyle = '#666';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isConnected ? 'Waiting for map data...' : 'Not connected to ROS', width / 2, height / 2);
      return;
    }

    const { info, data } = mapData;
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

    // Draw grid cells with better performance
    const cellPixelSize = Math.max(1, Math.round(cellSize / resolution));

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const idx = y * mapWidth + x;
        const value = data[idx];

        // Skip unknown cells to improve performance
        if (value === -1) continue;

        // Determine color
        let color: string;
        if (value === 100) {
          color = '#1e1e1e'; // occupied = dark
        } else {
          color = '#f0f0f0'; // free = white
        }

        // Calculate position relative to origin
        // x is column index, y is row index
        const worldX = originX + x * resolution;
        const worldY = originY + (mapHeight - 1 - y) * resolution;

        const screenX = centerX + worldX * cellSize;
        const screenY = centerY - worldY * cellSize;

        ctx.fillStyle = color;
        ctx.fillRect(screenX, screenY, cellPixelSize, cellPixelSize);
      }
    }

    // Draw grid lines (1 meter spacing)
    if (cellSize >= 10) {
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
    if (actualPose && layers.tf) {
      const robotScreenX = centerX + actualPose.x * cellSize;
      const robotScreenY = centerY - actualPose.y * cellSize; // Flip Y

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
      const arrowAngle = actualPose.theta;
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
    if (layers.laser && laserPoints.length > 0 && actualPose) {
      const robotScreenX = centerX + actualPose.x * cellSize;
      const robotScreenY = centerY - actualPose.y * cellSize;

      ctx.fillStyle = '#ef4444';
      const pointSize = Math.max(1, cellSize / 20);

      for (const point of laserPoints) {
        // Transform point from laser frame to map frame using robot pose
        // Laser is at robot position, so we just add robot position
        const mapX = actualPose.x + point.x;
        const mapY = actualPose.y + point.y;

        const screenX = centerX + mapX * cellSize;
        const screenY = centerY - mapY * cellSize;

        ctx.beginPath();
        ctx.arc(screenX, screenY, pointSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw map origin marker
    const originX = centerX + info.origin.position.x * cellSize;
    const originY = centerY - info.origin.position.y * cellSize;

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(originX, originY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.font = '12px sans-serif';
    ctx.fillText('origin', originX + 8, originY - 8);

  }, [mapData, actualPose, canvasSize, view, isConnected, laserPoints, layers]);

  // Animation loop for continuous rendering
  useEffect(() => {
    let animationId: number;

    const render = () => {
      draw();
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [draw]);

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
            <span>Laser ({laserPoints.length} pts)</span>
          </div>
        )}
      </div>
    </div>
  );
}
