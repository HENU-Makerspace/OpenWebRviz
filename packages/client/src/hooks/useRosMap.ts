import { useState, useEffect, useRef, useCallback } from 'react';
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

export function useRosMap(ros: ROSLIB.Ros | null, mapTopic: string = '/map', paused: boolean = false) {
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to map
  useEffect(() => {
    if (!ros) {
      setMapData(null);
      setIsMapLoaded(false);
      return;
    }

    const mapSub = new ROSLIB.Topic({
      ros,
      name: mapTopic,
      messageType: 'nav_msgs/msg/OccupancyGrid',
      compression: 'png',
    });

    mapSub.subscribe((message: unknown) => {
      if (paused) return; // Skip if paused
      const gridMsg = message as MapData;
      setMapData(gridMsg);
      setIsMapLoaded(true);
      console.log('[useRosMap] Received map:', gridMsg.info.width, 'x', gridMsg.info.height);
    });

    (mapSub as any).on('error', (err: Error) => {
      console.error('[useRosMap] Map subscription error:', err);
      setError(err.message);
    });

    return () => {
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

// Hook for TF listener
export function useRosTf(
  ros: ROSLIB.Ros | null,
  targetFrame: string = 'map',
  sourceFrame: string = 'base_link',
  paused: boolean = false
) {
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);

  useEffect(() => {
    if (!ros) {
      setRobotPose(null);
      return;
    }

    const tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame: targetFrame,
      angularThres: 0.01,
      transThres: 0.01,
    });

    // Wait for transform to become available
    tfClient.subscribe(sourceFrame, (transform) => {
      if (paused) return; // Skip if paused
      if (transform) {
        const pose: RobotPose = {
          x: transform.translation.x,
          y: transform.translation.y,
          theta: quatToTheta(transform.rotation),
          frameId: sourceFrame,
        };
        setRobotPose(pose);
      }
    });

    return () => {
      tfClient.unsubscribe(sourceFrame);
      setRobotPose(null);
    };
  }, [ros, targetFrame, sourceFrame, paused]);

  return robotPose;
}

// Convert quaternion to theta (yaw)
function quatToTheta(q: { x: number; y: number; z: number; w: number }): number {
  const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
  const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(siny_cosp, cosy_cosp);
}
