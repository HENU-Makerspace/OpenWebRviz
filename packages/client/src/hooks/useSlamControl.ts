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

export interface RosbridgeStatus {
  running: boolean;
}

export interface NetworkInfo {
  ips: string[];
  hostname: string;
  port: number;
}

export function useSlamControl() {
  const [slamRunning, setSlamRunning] = useState<boolean | null>(null); // null = unknown/uninitialized
  const [usingTmux, setUsingTmux] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const startSlam = useCallback(async (configPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/slam/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configPath }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSlamRunning(true);
        setUsingTmux(false);
      }
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  const startWithTmux = useCallback(async (scriptPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/slam/start-tmux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSlamRunning(true);
        setUsingTmux(true);
      }
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  const stopSlam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (usingTmux) {
        await fetch('/api/slam/stop-tmux', { method: 'POST' });
      } else {
        await fetch('/api/slam/stop', { method: 'POST' });
      }
      setSlamRunning(false);
      setUsingTmux(false);
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [usingTmux]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    slamRunning,
    slamRunningInitialized: initialized.current,
    loading,
    error,
    usingTmux,
    startSlam,
    startWithTmux,
    stopSlam,
    checkStatus,
  };
}

export function useRosbridgeControl() {
  const [rosbridgeRunning, setRosbridgeRunning] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/rosbridge/status');
      const data: RosbridgeStatus = await res.json();
      setRosbridgeRunning(data.running);
    } catch {
      setRosbridgeRunning(false);
    } finally {
      initialized.current = true;
    }
  }, []);

  const startRosbridge = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/rosbridge/start', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setRosbridgeRunning(true);
      }
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  const stopRosbridge = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/rosbridge/stop', { method: 'POST' });
      setRosbridgeRunning(false);
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    rosbridgeRunning,
    rosbridgeInitialized: initialized.current,
    loading,
    error,
    startRosbridge,
    stopRosbridge,
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

  const saveMap = useCallback(async (name?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/maps/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return null;
      }
      await fetchMaps();
      return data.map;
    } catch (e) {
      setError('Failed to connect to server');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchMaps]);

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
    saveMap,
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
