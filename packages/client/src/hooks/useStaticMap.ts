import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import type { MapData } from './useRosMap';

interface StaticMapMeta {
  requestId: string;
  mapName: string;
}

export interface StaticMapState {
  mapData: MapData | null;
  mapName: string | null;
  loading: boolean;
  error: string | null;
  requestId: string | null;
}

export interface MapEditResult {
  requestId: string;
  mapName: string;
  success: boolean;
  message: string;
  changedCount: number;
  backupPath: string;
}

function createRequestId(prefix: string) {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function parseStaticMapFrame(frameId: string): StaticMapMeta | null {
  const parts = String(frameId || '').split('|');
  if (parts.length !== 3 || parts[0] !== 'static_map' || !parts[1] || !parts[2]) {
    return null;
  }

  return {
    requestId: parts[1],
    mapName: parts[2],
  };
}

export function useStaticMap(ros: ROSLIB.Ros | null, selectedMap: string | null, isConnected: boolean) {
  const [state, setState] = useState<StaticMapState>({
    mapData: null,
    mapName: null,
    loading: false,
    error: null,
    requestId: null,
  });
  const [lastEditResult, setLastEditResult] = useState<MapEditResult | null>(null);
  const activeRequestRef = useRef<{ requestId: string; mapName: string } | null>(null);
  const requestPubRef = useRef<any>(null);
  const editPubRef = useRef<any>(null);
  const pendingEditRef = useRef<{ requestId: string; mapName: string } | null>(null);
  const requestTimeoutRef = useRef<number | null>(null);

  const clearRequestTimeout = useCallback(() => {
    if (requestTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(requestTimeoutRef.current);
    requestTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (!ros) {
      requestPubRef.current = null;
      editPubRef.current = null;
      clearRequestTimeout();
      return;
    }

    requestPubRef.current = new ROSLIB.Topic({
      ros,
      name: '/system/request_static_map',
      messageType: 'std_msgs/msg/String',
    });
    editPubRef.current = new ROSLIB.Topic({
      ros,
      name: '/system/edit_map',
      messageType: 'std_msgs/msg/String',
    });

    return () => {
      requestPubRef.current?.unadvertise?.();
      editPubRef.current?.unadvertise?.();
      requestPubRef.current = null;
      editPubRef.current = null;
      clearRequestTimeout();
    };
  }, [clearRequestTimeout, ros]);

  const requestMap = useCallback((mapName: string) => {
    clearRequestTimeout();

    if (!requestPubRef.current) {
      setState({
        mapData: null,
        mapName,
        loading: false,
        error: 'ROS 未连接，无法加载地图',
        requestId: null,
      });
      return null;
    }

    const requestId = createRequestId('map');
    activeRequestRef.current = { requestId, mapName };
    setState({
      mapData: null,
      mapName,
      loading: true,
      error: null,
      requestId,
    });
    requestPubRef.current.publish({
      data: JSON.stringify({
        requestId,
        mapName,
        mapYamlFile: `/home/nvidia/maps/${mapName}.yaml`,
      }),
    });
    requestTimeoutRef.current = window.setTimeout(() => {
      const active = activeRequestRef.current;
      if (!active || active.requestId !== requestId || active.mapName !== mapName) {
        return;
      }

      activeRequestRef.current = null;
      setState({
        mapData: null,
        mapName,
        loading: false,
        error: '地图加载超时，请检查 Jetson 是否运行新版 system_manager',
        requestId,
      });
      requestTimeoutRef.current = null;
    }, 5000);
    return requestId;
  }, [clearRequestTimeout]);

  useEffect(() => {
    if (!selectedMap || !isConnected) {
      clearRequestTimeout();
      activeRequestRef.current = null;
      setState({
        mapData: null,
        mapName: selectedMap,
        loading: false,
        error: selectedMap ? 'ROS 未连接，无法加载地图' : null,
        requestId: null,
      });
      return;
    }

    const timer = window.setTimeout(() => {
      requestMap(selectedMap);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [isConnected, requestMap, selectedMap]);

  useEffect(() => {
    if (!ros) {
      return;
    }

    const staticMapSub = new ROSLIB.Topic({
      ros,
      name: '/system/static_map',
      messageType: 'nav_msgs/msg/OccupancyGrid',
    });

    staticMapSub.subscribe((message: unknown) => {
      const mapMessage = message as MapData;
      const meta = parseStaticMapFrame(mapMessage.header?.frame_id || '');
      const active = activeRequestRef.current;
      if (!meta || !active || meta.requestId !== active.requestId || meta.mapName !== active.mapName) {
        return;
      }

      clearRequestTimeout();
      setState({
        mapData: mapMessage,
        mapName: meta.mapName,
        loading: false,
        error: null,
        requestId: meta.requestId,
      });
    });

    return () => {
      staticMapSub.unsubscribe();
    };
  }, [clearRequestTimeout, ros]);

  useEffect(() => {
    if (!ros) {
      return;
    }

    const resultSub = new ROSLIB.Topic({
      ros,
      name: '/system/edit_map_result',
      messageType: 'std_msgs/msg/String',
    });

    resultSub.subscribe((message: unknown) => {
      const msg = message as { data?: string };
      if (!msg.data) {
        return;
      }

      try {
        const payload = JSON.parse(msg.data) as MapEditResult;
        const pending = pendingEditRef.current;
        if (!pending || payload.requestId !== pending.requestId || payload.mapName !== pending.mapName) {
          return;
        }

        pendingEditRef.current = null;
        setLastEditResult(payload);
        if (payload.success) {
          requestMap(payload.mapName);
        }
      } catch (error) {
        console.error('[useStaticMap] Failed to parse edit result:', error);
      }
    });

    return () => {
      resultSub.unsubscribe();
    };
  }, [requestMap, ros]);

  const publishErase = useCallback((mapName: string, cells: number[]) => {
    if (!editPubRef.current || cells.length === 0) {
      return null;
    }

    const requestId = createRequestId('edit');
    pendingEditRef.current = { requestId, mapName };
    setLastEditResult(null);
    editPubRef.current.publish({
      data: JSON.stringify({
        requestId,
        mapName,
        mapYamlFile: `/home/nvidia/maps/${mapName}.yaml`,
        operation: 'erase',
        cells,
      }),
    });
    return requestId;
  }, []);

  return useMemo(
    () => ({
      ...state,
      lastEditResult,
      requestMap,
      publishErase,
    }),
    [lastEditResult, publishErase, requestMap, state]
  );
}
