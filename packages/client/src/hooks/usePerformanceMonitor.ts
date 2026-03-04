import { useState, useEffect, useRef } from 'react';

interface DebugStats {
  fps: number;
  mapUpdates: number;
  tfUpdates: number;
  laserUpdates: number;
}

export function usePerformanceMonitor() {
  const [stats, setStats] = useState<DebugStats>({
    fps: 0,
    mapUpdates: 0,
    tfUpdates: 0,
    laserUpdates: 0,
  });

  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const mapCountRef = useRef(0);
  const tfCountRef = useRef(0);
  const laserCountRef = useRef(0);

  useEffect(() => {
    let animationId: number;

    const updateStats = () => {
      const now = performance.now();
      const delta = now - lastTimeRef.current;

      if (delta >= 1000) {
        setStats({
          fps: Math.round(frameCountRef.current * 1000 / delta),
          mapUpdates: mapCountRef.current,
          tfUpdates: tfCountRef.current,
          laserUpdates: laserCountRef.current,
        });

        frameCountRef.current = 0;
        mapCountRef.current = 0;
        tfCountRef.current = 0;
        laserCountRef.current = 0;
        lastTimeRef.current = now;
      }

      frameCountRef.current++;
      animationId = requestAnimationFrame(updateStats);
    };

    animationId = requestAnimationFrame(updateStats);

    return () => cancelAnimationFrame(animationId);
  }, []);

  // Call these when receiving updates
  const onMapUpdate = () => { mapCountRef.current++; };
  const onTfUpdate = () => { tfCountRef.current++; };
  const onLaserUpdate = () => { laserCountRef.current++; };

  return { stats, onMapUpdate, onTfUpdate, onLaserUpdate };
}

export function DebugPanel() {
  const { stats } = usePerformanceMonitor();

  return (
    <div className="absolute top-4 left-4 bg-black/80 text-green-400 px-3 py-2 rounded text-xs font-mono">
      <div>FPS: {stats.fps}</div>
      <div>Map: {stats.mapUpdates}/s</div>
      <div>TF: {stats.tfUpdates}/s</div>
      <div>Laser: {stats.laserUpdates}/s</div>
    </div>
  );
}
