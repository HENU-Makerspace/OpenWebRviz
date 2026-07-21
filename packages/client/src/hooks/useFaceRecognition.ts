import { useCallback, useEffect, useRef, useState } from 'react';

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
  const inFlightRef = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!config?.enabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      return Promise.resolve();
    }

    if (inFlightRef.current) {
      return inFlightRef.current.promise;
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const response = await fetch(config.latestUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
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
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }

        setSnapshot((current) => ({
          ...current,
          online: false,
        }));
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (inFlightRef.current?.controller === controller) {
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = { controller, promise };
    return promise;
  }, [config]);

  useEffect(() => {
    if (!config?.enabled || !active) {
      return;
    }

    let stopped = false;
    let timer: number | null = null;
    const intervalMs = Math.max(Number(config.pollIntervalMs) || 500, 200);

    const poll = async () => {
      await refresh();
      if (!stopped) {
        timer = window.setTimeout(() => {
          void poll();
        }, intervalMs);
      }
    };

    void poll();

    return () => {
      stopped = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      inFlightRef.current?.controller.abort();
    };
  }, [active, config, refresh]);

  return {
    snapshot,
    error,
    refresh,
  };
}
