import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

export interface LaserScanData {
  angleMin: number;
  angleMax: number;
  angleIncrement: number;
  rangeMin: number;
  rangeMax: number;
  ranges: number[];
  frameId: string;
}

function normalizeFrameId(frameId: string | undefined) {
  return (frameId || '').trim().replace(/^\/+/, '');
}

export function useRosScan(
  ros: ROSLIB.Ros | null,
  topicName: string = '/scan',
  paused: boolean = false
) {
  const [scanData, setScanData] = useState<LaserScanData | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestScanRef = useRef<LaserScanData | null>(null);

  useEffect(() => {
    if (!ros) {
      setScanData(null);
      return;
    }

    const scanSub = new ROSLIB.Topic({
      ros,
      name: topicName,
      messageType: 'sensor_msgs/msg/LaserScan',
    });

    const flushLatest = () => {
      rafRef.current = null;
      if (latestScanRef.current) {
        setScanData(latestScanRef.current);
      }
    };

    scanSub.subscribe((message: unknown) => {
      if (paused) return;

      const msg = message as {
        header: { frame_id: string };
        angle_min: number;
        angle_max: number;
        angle_increment: number;
        range_min: number;
        range_max: number;
        ranges: number[];
      };

      if (!msg.ranges || !Array.isArray(msg.ranges)) return;

      latestScanRef.current = {
        angleMin: msg.angle_min,
        angleMax: msg.angle_max,
        angleIncrement: msg.angle_increment,
        rangeMin: msg.range_min,
        rangeMax: msg.range_max,
        ranges: msg.ranges,
        frameId: normalizeFrameId(msg.header?.frame_id),
      };

      if (rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(flushLatest);
      }
    });

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      scanSub.unsubscribe();
      setScanData(null);
    };
  }, [ros, topicName, paused]);

  return { scanData };
}
