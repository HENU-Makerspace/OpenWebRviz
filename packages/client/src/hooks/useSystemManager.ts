import { useState, useEffect, useCallback } from 'react';
import * as ROSLIB from 'roslib';

export type RobotMode = 'idle' | 'slam' | 'navigation';

export interface RobotStatus {
  mode: RobotMode;
  pid: number | null;
  loading: boolean;
  error: string | null;
}

interface StartNavRequest {
  map_yaml_file: string;
}

interface ServiceResponse {
  success: boolean;
  message: string;
}

export function useSystemManager(ros: ROSLIB.Ros | null, isConnected: boolean) {
  const [status, setStatus] = useState<RobotStatus>({
    mode: 'idle',
    pid: null,
    loading: false,
    error: null,
  });

  // 调用 ROS 服务的辅助函数 (for Trigger services)
  const callService = useCallback(<T = any>(serviceName: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!ros || !isConnected) {
        reject(new Error('Not connected to ROS'));
        return;
      }

      const service = new ROSLIB.Service<Record<string, never>, T>({
        ros,
        name: serviceName,
        serviceType: 'std_srvs/srv/Trigger',
      });

      service.callService({}, (response: T) => {
        resolve(response);
      }, (error: string) => {
        reject(new Error(error));
      }, 10);
    });
  }, [ros, isConnected]);

  // 调用导航服务 (需要传递 map_yaml_file)
  const callStartNavService = useCallback((mapYamlPath: string): Promise<ServiceResponse> => {
    return new Promise((resolve, reject) => {
      if (!ros || !isConnected) {
        reject(new Error('Not connected to ROS'));
        return;
      }

      const service = new ROSLIB.Service<StartNavRequest, ServiceResponse>({
        ros,
        name: '/system/start_nav',
        serviceType: 'jetson_interfaces/srv/StartNav',
      });

      const request: StartNavRequest = {
        map_yaml_file: mapYamlPath,
      };

      service.callService(request, (response: ServiceResponse) => {
        resolve(response);
      }, (error: string) => {
        reject(new Error(error));
      }, 10);
    });
  }, [ros, isConnected]);

  // 检查机器人状态
  const checkStatus = useCallback(async () => {
    try {
      const response = await callService<{ success: boolean; message: string }>('/system/status');
      if (response.success) {
        const [mode, pidStr] = response.message.split('|');
        const pid = pidStr ? parseInt(pidStr, 10) : null;
        setStatus(prev => ({
          ...prev,
          mode: mode as RobotMode,
          pid,
        }));
      }
    } catch (e) {
      console.error('Failed to check status:', e);
    }
  }, [callService]);

  // 启动 SLAM
  const startSlam = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await callService<{ success: boolean; message: string }>('/system/start_slam');
      if (response.success) {
        setStatus({ mode: 'slam', pid: null, loading: false, error: null });
      } else {
        setStatus(prev => ({ ...prev, loading: false, error: response.message }));
      }
    } catch (e: any) {
      setStatus(prev => ({ ...prev, loading: false, error: e.message }));
    }
  }, [callService]);

  // 启动导航 (需要传递地图路径)
  const startNavigation = useCallback(async (mapYamlPath: string) => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await callStartNavService(mapYamlPath);
      if (response.success) {
        setStatus({ mode: 'navigation', pid: null, loading: false, error: null });
      } else {
        setStatus(prev => ({ ...prev, loading: false, error: response.message }));
      }
    } catch (e: any) {
      setStatus(prev => ({ ...prev, loading: false, error: e.message }));
    }
  }, [callStartNavService]);

  // 停止
  const stopAll = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await callService<{ success: boolean; message: string }>('/system/stop_all');
      if (response.success) {
        setStatus({ mode: 'idle', pid: null, loading: false, error: null });
      } else {
        setStatus(prev => ({ ...prev, loading: false, error: response.message }));
      }
    } catch (e: any) {
      setStatus(prev => ({ ...prev, loading: false, error: e.message }));
    }
  }, [callService]);

  // 保存地图
  const saveMap = useCallback(async (): Promise<string | null> => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    try {
      const response = await callService<{ success: boolean; message: string }>('/system/save_map');
      setStatus(prev => ({ ...prev, loading: false }));
      if (response.success) {
        return response.message; // 返回地图名称
      } else {
        setStatus(prev => ({ ...prev, error: response.message }));
        return null;
      }
    } catch (e: any) {
      setStatus(prev => ({ ...prev, loading: false, error: e.message }));
      return null;
    }
  }, [callService]);

  // 定时检查状态
  useEffect(() => {
    if (isConnected) {
      checkStatus();
      const interval = setInterval(checkStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [isConnected, checkStatus]);

  return {
    status,
    startSlam,
    startNavigation,
    stopAll,
    saveMap,
    checkStatus,
  };
}
