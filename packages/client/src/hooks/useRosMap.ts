import { useState, useEffect, useRef } from 'react';
import * as ROSLIB from 'roslib';

export interface MapData {
  header: {
    stamp: { sec: number; nsec: number };
    frame_id: string;
  };
  info: {
    map_load_time: { sec: number; nsec: number };
    resolution: number;
    width: number;
    height: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[];
}

export interface RobotPose {
  x: number;
  y: number;
  theta: number;
  frameId: string;
}

export function useRosMap(ros: ROSLIB.Ros | null, mapTopic: string | null = '/map', paused: boolean = false) {
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestMapRef = useRef<MapData | null>(null);

  // Subscribe to map
  useEffect(() => {
    // If no topic specified (navigation mode with static map), don't subscribe
    if (!ros || !mapTopic) {
      setMapData(null);
      setIsMapLoaded(false);
      return;
    }

    const mapSub = new ROSLIB.Topic({
      ros,
      name: mapTopic,
      messageType: 'nav_msgs/msg/OccupancyGrid',
    });

    const flushLatest = () => {
      rafRef.current = null;
      if (latestMapRef.current) {
        setMapData(latestMapRef.current);
        setIsMapLoaded(true);
      }
    };

    mapSub.subscribe((message: unknown) => {
      if (paused) return;
      const gridMsg = message as MapData;
      latestMapRef.current = gridMsg;
      if (rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(flushLatest);
      }
    });

    (mapSub as any).on('error', (err: Error) => {
      setError(err.message);
    });

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      mapSub.unsubscribe();
      setMapData(null);
      setIsMapLoaded(false);
    };
  }, [ros, mapTopic, paused]);

  return {
    mapData,
    robotPose,
    setRobotPose,
    isMapLoaded,
    error,
  };
}
