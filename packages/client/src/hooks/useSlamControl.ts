import { useState, useEffect, useCallback, useRef } from 'react';
import * as ROSLIB from 'roslib';

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

export function useMapManager(ros: ROSLIB.Ros | null = null, isConnected: boolean = false) {
  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gotTopicDataRef = useRef(false);

  const fetchMaps = useCallback(async () => {
    return maps;
  }, [maps]);

  const deleteMap = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      await fetch(`/api/maps/${name}`, { method: 'DELETE' });
    } catch (e) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ros || !isConnected) {
      return;
    }

    setLoading(true);
    setError(null);
    gotTopicDataRef.current = false;

    const topic = new ROSLIB.Topic({
      ros,
      name: '/system/map_list',
      messageType: 'std_msgs/msg/String',
    });

    topic.subscribe((message: unknown) => {
      const msg = message as { data?: string };
      if (!msg?.data) {
        return;
      }

      try {
        const parsed = JSON.parse(msg.data);
        const nextMaps = Array.isArray(parsed?.maps) ? parsed.maps : [];
        gotTopicDataRef.current = true;
        setMaps(nextMaps);
        setError(null);
        setLoading(false);
      } catch (e) {
        setError('Failed to parse map list topic');
      }
    });

    if (!gotTopicDataRef.current) {
      void fetchMaps();
    }

    return () => {
      topic.unsubscribe();
    };
  }, [isConnected, ros]);

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
