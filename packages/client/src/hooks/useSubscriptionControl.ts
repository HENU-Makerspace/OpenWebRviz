import { useState, useCallback, useRef, useEffect } from 'react';

// Settings for data subscription
export interface SubscriptionSettings {
  rate: number; // Hz (messages per second), 0 = unlimited
  paused: boolean;
}

export function useSubscriptionControl(defaultRate: number = 10) {
  const [settings, setSettings] = useState<SubscriptionSettings>({
    rate: defaultRate,
    paused: false,
  });

  const lastUpdateRef = useRef(0);
  const pendingUpdateRef = useRef<(() => void) | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Check if we should update based on rate limiting
  const shouldUpdate = useCallback(() => {
    if (settings.paused) return false;
    if (settings.rate === 0) return true;

    const now = performance.now();
    const minInterval = 1000 / settings.rate;

    if (now - lastUpdateRef.current >= minInterval) {
      lastUpdateRef.current = now;
      return true;
    }
    return false;
  }, [settings.rate, settings.paused]);

  // Schedule an update with rate limiting
  const scheduleUpdate = useCallback((updateFn: () => void) => {
    if (settings.paused) return;

    if (settings.rate === 0) {
      // No rate limiting
      updateFn();
    } else {
      // Rate limited - schedule via animation frame
      pendingUpdateRef.current = updateFn;

      if (!animationFrameRef.current) {
        const scheduleFrame = () => {
          const now = performance.now();
          const minInterval = 1000 / settings.rate;
          const timeSinceLastUpdate = now - lastUpdateRef.current;

          if (timeSinceLastUpdate >= minInterval && pendingUpdateRef.current) {
            pendingUpdateRef.current();
            pendingUpdateRef.current = null;
            lastUpdateRef.current = now;
          }

          if (pendingUpdateRef.current) {
            animationFrameRef.current = requestAnimationFrame(scheduleFrame);
          } else {
            animationFrameRef.current = null;
          }
        };
        animationFrameRef.current = requestAnimationFrame(scheduleFrame);
      }
    }
  }, [settings.rate, settings.paused]);

  // Cleanup on unmount or settings change
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [settings.rate]);

  const setRate = useCallback((rate: number) => {
    setSettings(prev => ({ ...prev, rate: Math.max(0, rate) }));
  }, []);

  const togglePause = useCallback(() => {
    setSettings(prev => ({ ...prev, paused: !prev.paused }));
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setSettings(prev => ({ ...prev, paused }));
  }, []);

  return {
    settings,
    shouldUpdate,
    scheduleUpdate,
    setRate,
    togglePause,
    setPaused,
  };
}
