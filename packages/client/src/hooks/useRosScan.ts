import { useEffect, useState } from 'react';
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

export function useRosScan(
  ros: ROSLIB.Ros | null,
  topicName: string = '/scan',
  paused: boolean = false
) {
  const [scanData, setScanData] = useState<LaserScanData | null>(null);

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

      setScanData({
        angleMin: msg.angle_min,
        angleMax: msg.angle_max,
        angleIncrement: msg.angle_increment,
        rangeMin: msg.range_min,
        rangeMax: msg.range_max,
        ranges: msg.ranges,
        frameId: msg.header?.frame_id || '',
      });
    });

    return () => {
      scanSub.unsubscribe();
      setScanData(null);
    };
  }, [ros, topicName, paused]);

  return { scanData };
}