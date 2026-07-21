import { useCallback, useEffect, useState } from 'react';

export interface FaceConfig {
  enabled: boolean;
  latestUrl: string;
  healthUrl: string;
  pollIntervalMs: number;
}

export interface FaceDetection {
  id: string;
  label: string;
  name?: string | null;
  sid?: string | null;
  score?: number;
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface FaceSnapshot {
  online: boolean;
  updatedAt: string | null;
  frameWidth: number;
  frameHeight: number;
  faces: FaceDetection[];
}

const EMPTY_SNAPSHOT: FaceSnapshot = {
  online: false,
  updatedAt: null,
  frameWidth: 0,
  frameHeight: 0,
  faces: [],
};

export function useFaceRecognition(config: FaceConfig | null, active: boolean) {
  const [snapshot, setSnapshot] = useState<FaceSnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!config?.enabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    try {
      const response = await fetch(config.latestUrl);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || `Request failed: ${response.status}`);
      }

      setSnapshot({
        online: Boolean(data?.online),
        updatedAt: data?.updatedAt || null,
        frameWidth: Number(data?.frameWidth) || 0,
        frameHeight: Number(data?.frameHeight) || 0,
        faces: Array.isArray(data?.faces) ? data.faces : [],
      });
      setError(null);
    } catch (err) {
      setSnapshot((current) => ({
        ...current,
        online: false,
      }));
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [config]);

  useEffect(() => {
    if (!config?.enabled || !active) {
      return;
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, Math.max(Number(config.pollIntervalMs) || 500, 200));

    return () => {
      window.clearInterval(timer);
    };
  }, [active, config, refresh]);

  return {
    snapshot,
    error,
    refresh,
  };
}
