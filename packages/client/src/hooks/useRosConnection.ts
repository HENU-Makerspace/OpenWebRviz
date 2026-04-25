import { useState, useEffect, useCallback, useRef } from 'react';
import * as ROSLIB from 'roslib';

// Connection states
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;

export function useRosConnection(wsUrl: string) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const connectionStateRef = useRef<ConnectionState>('disconnected');
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const errorRef = useRef<string | null>(null);

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

    // Close existing connection
    if (rosRef.current) {
      rosRef.current.close();
      rosRef.current = null;
    }

    try {
      setConnectionState('connecting');
      setError(null);
      errorRef.current = null;

      const rosInstance = new ROSLIB.Ros({
        url: wsUrl,
      });

      // Set up timeout (10 seconds)
      const timeoutId = setTimeout(() => {
        if (connectionStateRef.current === 'connecting') {
          rosInstance.close();
          setConnectionState('error');
          const message = 'Connection timeout. Is rosbridge_websocket running at ' + wsUrl + '?';
          errorRef.current = message;
          setError(message);
        }
      }, 10000);

      rosInstance.on('connection', () => {
        clearTimeout(timeoutId);
        console.log('Connected to ROS WebSocket server');
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        setError(null);
        errorRef.current = null;
      });

      (rosInstance as any).on('error', (err: unknown) => {
        clearTimeout(timeoutId);
        console.error('ROS connection error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Connection error';
        errorRef.current = errorMessage;
        setConnectionState('error');
        setError(errorMessage);
      });

      rosInstance.on('close', () => {
        clearTimeout(timeoutId);
        console.log('ROS WebSocket connection closed');
        rosRef.current = null;

        if (!shouldReconnectRef.current) {
          setConnectionState('disconnected');
          return;
        }

        setConnectionState('disconnected');
        scheduleReconnect(errorRef.current || 'ROS WebSocket connection closed');
      });

      rosRef.current = rosInstance;
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
    if (rosRef.current) {
      rosRef.current.close();
      rosRef.current = null;
    }
  }, [clearReconnectTimer]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  // Auto-connect on mount and whenever wsUrl changes.
  useEffect(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    setReconnectCount(0);
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      if (rosRef.current) {
        rosRef.current.close();
        rosRef.current = null;
      }
    };
  }, [clearReconnectTimer, connect, wsUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      if (rosRef.current) {
        rosRef.current.close();
        rosRef.current = null;
      }
    };
  }, [clearReconnectTimer]);

  return {
    ros: rosRef.current,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting',
    connectionState,
    error,
    reconnect,
    disconnect,
    reconnectCount,
  };
}
