import { useState, useEffect, useCallback, useRef } from 'react';
import * as ROSLIB from 'roslib';

// Connection states
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;
const CONNECTION_TIMEOUT_MS = 10000;

export function useRosConnection(wsUrl: string) {
  const [ros, setRos] = useState<ROSLIB.Ros | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const connectionStateRef = useRef<ConnectionState>('disconnected');
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const errorRef = useRef<string | null>(null);
  const sessionIdRef = useRef(0);

  const disposeRos = useCallback((instance?: ROSLIB.Ros | null) => {
    const target = instance || rosRef.current;
    if (!target) {
      return;
    }

    try {
      target.close();
    } catch {
      // Ignore socket shutdown errors during reconnect cleanup.
    }

    if (rosRef.current === target) {
      rosRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback((reason?: string) => {
    if (!wsUrl || !shouldReconnectRef.current || reconnectTimerRef.current != null) {
      return;
    }

    reconnectAttemptRef.current += 1;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** (reconnectAttemptRef.current - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    setConnectionState('error');
    setError(reason || errorRef.current || `ROS 连接已断开，${Math.round(delay / 1000)} 秒后重试`);
    setReconnectCount((count) => count + 1);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (shouldReconnectRef.current) {
        connect();
      }
    }, delay);
  }, [wsUrl]);

  const connect = useCallback(() => {
    if (!wsUrl) {
      return;
    }

    shouldReconnectRef.current = true;
    clearReconnectTimer();

    // Don't connect if already connecting or connected
    if (connectionStateRef.current === 'connecting' || connectionStateRef.current === 'connected') {
      return;
    }

    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;

    if (rosRef.current) {
      const previousRos = rosRef.current;
      rosRef.current = null;
      disposeRos(previousRos);
    }

    try {
      setRos(null);
      setConnectionState('connecting');
      setError(null);
      errorRef.current = null;

      const rosInstance = new ROSLIB.Ros({
        url: wsUrl,
      });

      const timeoutId = window.setTimeout(() => {
        if (sessionIdRef.current !== sessionId || connectionStateRef.current !== 'connecting') {
          return;
        }

        const message = 'Connection timeout. Is rosbridge_websocket running at ' + wsUrl + '?';
        errorRef.current = message;
        setError(message);
        setConnectionState('error');
        disposeRos(rosInstance);
        setRos(null);
        scheduleReconnect(message);
      }, CONNECTION_TIMEOUT_MS);

      rosInstance.on('connection', () => {
        if (sessionIdRef.current !== sessionId) {
          disposeRos(rosInstance);
          return;
        }

        window.clearTimeout(timeoutId);
        console.log('Connected to ROS WebSocket server');
        reconnectAttemptRef.current = 0;
        rosRef.current = rosInstance;
        setRos(rosInstance);
        setConnectionState('connected');
        setError(null);
        errorRef.current = null;
      });

      (rosInstance as any).on('error', (err: unknown) => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        window.clearTimeout(timeoutId);
        console.error('ROS connection error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Connection error';
        errorRef.current = errorMessage;
        setError(errorMessage);

        if (connectionStateRef.current === 'connected') {
          return;
        }

        setConnectionState('error');
        setRos(null);

        if (shouldReconnectRef.current) {
          if (rosRef.current === rosInstance) {
            rosRef.current = null;
          }
          disposeRos(rosInstance);
          scheduleReconnect(errorMessage);
        }
      });

      rosInstance.on('close', () => {
        if (sessionIdRef.current !== sessionId) {
          return;
        }

        window.clearTimeout(timeoutId);
        console.log('ROS WebSocket connection closed');
        if (rosRef.current === rosInstance) {
          rosRef.current = null;
        }
        setRos(null);

        if (!shouldReconnectRef.current) {
          setConnectionState('disconnected');
          return;
        }

        setConnectionState('disconnected');
        scheduleReconnect(errorRef.current || 'ROS WebSocket connection closed');
      });
    } catch (err) {
      console.error('Failed to create ROS connection:', err);
      const message = err instanceof Error ? err.message : 'Failed to connect';
      errorRef.current = message;
      setConnectionState('error');
      setError(message);
      scheduleReconnect(message);
    }
  }, [clearReconnectTimer, scheduleReconnect, wsUrl]);

  // Sync ref with state
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    setConnectionState('disconnected');
    setError(null);
      errorRef.current = null;
      sessionIdRef.current += 1;
      if (rosRef.current) {
        disposeRos();
      }
      setRos(null);
  }, [clearReconnectTimer, disposeRos]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    sessionIdRef.current += 1;
    disposeRos();
    setRos(null);
    setConnectionState('disconnected');
    connect();
  }, [connect, disposeRos]);

  // Auto-connect on mount and whenever wsUrl changes.
  useEffect(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    setReconnectCount(0);
    connect();

    return () => {
      shouldReconnectRef.current = false;
      sessionIdRef.current += 1;
      clearReconnectTimer();
      disposeRos();
      setRos(null);
    };
  }, [clearReconnectTimer, connect, disposeRos, wsUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      sessionIdRef.current += 1;
      clearReconnectTimer();
      disposeRos();
      setRos(null);
    };
  }, [clearReconnectTimer, disposeRos]);

  return {
    ros,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting',
    connectionState,
    error,
    reconnect,
    disconnect,
    reconnectCount,
  };
}
