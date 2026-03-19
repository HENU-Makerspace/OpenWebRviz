import { useState, useEffect, useCallback, useRef } from 'react';
import * as ROSLIB from 'roslib';

// Connection states
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useRosConnection(wsUrl: string) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const reconnectCountRef = useRef(0);
  const connectionStateRef = useRef<ConnectionState>('disconnected');

  const connect = useCallback(() => {
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
      reconnectCountRef.current += 1;

      const rosInstance = new ROSLIB.Ros({
        url: wsUrl,
      });

      // Set up timeout (10 seconds)
      const timeoutId = setTimeout(() => {
        if (connectionStateRef.current === 'connecting') {
          rosInstance.close();
          setConnectionState('error');
          setError('Connection timeout. Is rosbridge_websocket running at ' + wsUrl + '?');
        }
      }, 10000);

      rosInstance.on('connection', () => {
        clearTimeout(timeoutId);
        console.log('Connected to ROS WebSocket server');
        setConnectionState('connected');
        setError(null);
      });

      (rosInstance as any).on('error', (err: unknown) => {
        clearTimeout(timeoutId);
        console.error('ROS connection error:', err);
        setConnectionState('error');
        const errorMessage = err instanceof Error ? err.message : 'Connection error';
        setError(errorMessage);
      });

      rosInstance.on('close', () => {
        clearTimeout(timeoutId);
        console.log('ROS WebSocket connection closed');
        if (connectionState !== 'disconnected') {
          setConnectionState('disconnected');
        }
      });

      rosRef.current = rosInstance;
    } catch (err) {
      console.error('Failed to create ROS connection:', err);
      setConnectionState('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [wsUrl]);

  // Sync ref with state
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const disconnect = useCallback(() => {
    setConnectionState('disconnected');
    if (rosRef.current) {
      rosRef.current.close();
      rosRef.current = null;
    }
  }, []);

  // Auto-connect when wsUrl changes or on mount
  useEffect(() => {
    if (wsUrl && (connectionState === 'disconnected' || connectionState === 'error')) {
      connect();
    }
  }, [wsUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rosRef.current) {
        rosRef.current.close();
        rosRef.current = null;
      }
    };
  }, []);

  return {
    ros: rosRef.current,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting',
    connectionState,
    error,
    reconnect: connect,
    disconnect,
    reconnectCount: reconnectCountRef.current,
  };
}
