import { useState, useEffect } from 'react';
import * as ROSLIB from 'roslib';

export interface LaserScanData {
  header: {
    stamp: { sec: number; nsec: number };
    frame_id: string;
  };
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  intensities: number[];
}

export interface LaserPoint {
  x: number;
  y: number;
  intensity: number;
}

export function useRosLaserScan(
  ros: ROSLIB.Ros | null,
  scanTopic: string = '/scan',
  paused: boolean = false
) {
  const [scanData, setScanData] = useState<LaserScanData | null>(null);
  const [laserPoints, setLaserPoints] = useState<LaserPoint[]>([]);
  const [isScanReceived, setIsScanReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ros) {
      setScanData(null);
      setLaserPoints([]);
      setIsScanReceived(false);
      return;
    }

    const scanSub = new ROSLIB.Topic({
      ros,
      name: scanTopic,
      messageType: 'sensor_msgs/msg/LaserScan',
      compression: 'png',
    });

    scanSub.subscribe((message: unknown) => {
      if (paused) return; // Skip if paused
      const scan = message as LaserScanData;
      setScanData(scan);
      setIsScanReceived(true);

      // Convert ranges to Cartesian coordinates
      const points: LaserPoint[] = [];
      const { angle_min, angle_increment, range_min, range_max, ranges } = scan;

      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i];

        // Skip invalid ranges
        if (range < range_min || range > range_max || !isFinite(range)) {
          continue;
        }

        const angle = angle_min + i * angle_increment;
        const x = range * Math.cos(angle);
        const y = range * Math.sin(angle);

        points.push({
          x,
          y,
          intensity: 1.0,
        });
      }

      setLaserPoints(points);
      console.log('[useRosLaserScan] Received scan with', points.length, 'points');
    });

    (scanSub as any).on('error', (err: Error) => {
      console.error('[useRosLaserScan] Scan subscription error:', err);
      setError(err.message);
    });

    return () => {
      scanSub.unsubscribe();
      setScanData(null);
      setLaserPoints([]);
      setIsScanReceived(false);
    };
  }, [ros, scanTopic, paused]);

  return {
    scanData,
    laserPoints,
    isScanReceived,
    error,
  };
}
