import { useState, useEffect, useCallback, useRef } from 'react';

export interface SavedMap {
  name: string;
  filename: string;
  path: string;
  created: string;
}

export interface SlamStatus {
  running: boolean;
  tmux: boolean;
}

export interface NetworkInfo {
  ips: string[];
  hostname: string;
  port: number;
}

export function useSlamControl() {
  const [slamRunning, setSlamRunning] = useState<boolean | null>(null); // null = unknown/uninitialized
  const [usingTmux, setUsingTmux] = useState(false);
  const initialized = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/slam/status');
      const data: SlamStatus = await res.json();
      setSlamRunning(data.running);
      setUsingTmux(data.tmux || false);
    } catch {
      setSlamRunning(false);
      setUsingTmux(false);
    } finally {
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    slamRunning,
    slamRunningInitialized: initialized.current,
    loading: false,
    error: null,
    usingTmux,
    checkStatus,
  };
}

export function useMapManager() {
  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/maps');
      const data = await res.json();
      setMaps(data.maps || []);
    } catch (e) {
      setError('Failed to connect to server');
      setMaps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteMap = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      await fetch(`/api/maps/${name}`, { method: 'DELETE' });
      await fetchMaps();
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [fetchMaps]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  return {
    maps,
    loading,
    error,
    fetchMaps,
    deleteMap,
  };
}

export function useNetworkInfo() {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);

  useEffect(() => {
    fetch('/api/network')
      .then(res => res.json())
      .then(setNetworkInfo)
      .catch(() => setNetworkInfo({ ips: ['localhost'], hostname: 'localhost', port: 4001 }));
  }, []);

  return networkInfo;
}
