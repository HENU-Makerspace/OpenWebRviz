import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

export type NavigationTaskMode = 'single' | 'route' | 'loop';
export type NavigationTaskState = 'idle' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface NavigationPose {
  id: string;
  x: number;
  y: number;
  theta: number;
}

export interface NavigationConfig {
  navigateToPoseAction?: string;
  navigateToPoseType?: string;
  navigateThroughPosesAction?: string;
  navigateThroughPosesType?: string;
  frameId?: string;
}

export interface NavigationTaskStatus {
  mode: NavigationTaskMode | null;
  state: NavigationTaskState;
  error: string | null;
  activeGoalId: string | null;
  iteration: number;
  waypointIndex: number;
  totalWaypoints: number;
  updatedAt: number | null;
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPoseStamped(pose: NavigationPose, frameId: string) {
  const now = Date.now();
  return {
    header: {
      stamp: {
        sec: Math.floor(now / 1000),
        nsec: (now % 1000) * 1000000,
      },
      frame_id: frameId,
    },
    pose: {
      position: {
        x: pose.x,
        y: pose.y,
        z: 0,
      },
      orientation: {
        x: 0,
        y: 0,
        z: Math.sin(pose.theta / 2),
        w: Math.cos(pose.theta / 2),
      },
    },
  };
}

export function createNavigationPose(x: number, y: number, theta: number) {
  return {
    id: makeId(),
    x,
    y,
    theta,
  } satisfies NavigationPose;
}

export function useNavigationTasks(
  ros: ROSLIB.Ros | null,
  isConnected: boolean,
  config?: NavigationConfig | null,
) {
  const [status, setStatus] = useState<NavigationTaskStatus>({
    mode: null,
    state: 'idle',
    error: null,
    activeGoalId: null,
    iteration: 0,
    waypointIndex: 0,
    totalWaypoints: 0,
    updatedAt: null,
  });

  const navigateToPoseActionRef = useRef<ROSLIB.Action<any, any, any> | null>(null);
  const activeGoalRef = useRef<{ id: string; mode: NavigationTaskMode } | null>(null);
  const queueContextRef = useRef<{
    poses: NavigationPose[];
    currentIndex: number;
    iteration: number;
    mode: NavigationTaskMode;
  } | null>(null);
  const cancelRequestedRef = useRef(false);
  const [pathResetToken, setPathResetToken] = useState(0);

  const frameId = config?.frameId || 'map';
  const navigateToPoseActionName = config?.navigateToPoseAction || '/navigate_to_pose';
  const navigateToPoseActionType = config?.navigateToPoseType || 'nav2_msgs/action/NavigateToPose';
  useEffect(() => {
    activeGoalRef.current = null;
    queueContextRef.current = null;
    cancelRequestedRef.current = false;

    if (!ros || !isConnected) {
      navigateToPoseActionRef.current = null;
      setStatus({
        mode: null,
        state: 'idle',
        error: null,
        activeGoalId: null,
        iteration: 0,
        waypointIndex: 0,
        totalWaypoints: 0,
        updatedAt: Date.now(),
      });
      return;
    }

    navigateToPoseActionRef.current = new ROSLIB.Action({
      ros,
      name: navigateToPoseActionName,
      actionType: navigateToPoseActionType,
    });

    return () => {
      navigateToPoseActionRef.current = null;
      activeGoalRef.current = null;
      queueContextRef.current = null;
      cancelRequestedRef.current = false;
    };
  }, [
    isConnected,
    navigateToPoseActionName,
    navigateToPoseActionType,
    ros,
  ]);

  const cancelCurrentTask = useCallback(() => {
    cancelRequestedRef.current = true;

    const activeGoal = activeGoalRef.current;
    if (activeGoal?.id) {
      navigateToPoseActionRef.current?.cancelGoal(activeGoal.id);
    }

    activeGoalRef.current = null;
    queueContextRef.current = null;
    setPathResetToken((value) => value + 1);
    setStatus((prev) => ({
      ...prev,
      state: prev.state === 'idle' ? 'idle' : 'canceled',
      activeGoalId: null,
      waypointIndex: 0,
      totalWaypoints: 0,
      updatedAt: Date.now(),
    }));
  }, []);

  const sendSingleGoal = useCallback((pose: NavigationPose, mode: NavigationTaskMode, iteration: number) => {
    if (!navigateToPoseActionRef.current) {
      throw new Error('NavigateToPose action is not ready');
    }

    let issuedGoalId: string | undefined;

    issuedGoalId = navigateToPoseActionRef.current.sendGoal(
      {
        pose: toPoseStamped(pose, frameId),
        behavior_tree: '',
      },
      () => {
        if (!issuedGoalId || activeGoalRef.current?.id !== issuedGoalId) {
          return;
        }

        if (cancelRequestedRef.current) {
          activeGoalRef.current = null;
          return;
        }

        if (queueContextRef.current) {
          const { poses, currentIndex, iteration: currentIteration, mode: currentMode } = queueContextRef.current;

          if (currentIndex < poses.length - 1) {
            const nextIndex = currentIndex + 1;
            queueContextRef.current = {
              poses,
              currentIndex: nextIndex,
              iteration: currentIteration,
              mode: currentMode,
            };
            sendSingleGoal(poses[nextIndex], currentMode, currentIteration);
            return;
          }

          if (currentMode === 'loop') {
            const nextIteration = currentIteration + 1;
            queueContextRef.current = {
              poses,
              currentIndex: 0,
              iteration: nextIteration,
              mode: currentMode,
            };
            sendSingleGoal(poses[0], currentMode, nextIteration);
            return;
          }

          queueContextRef.current = null;
          activeGoalRef.current = null;
          setPathResetToken((value) => value + 1);
          setStatus((prev) => ({
            ...prev,
            state: 'succeeded',
            activeGoalId: null,
            waypointIndex: poses.length,
            totalWaypoints: poses.length,
            updatedAt: Date.now(),
          }));
          return;
        }

        activeGoalRef.current = null;
        setPathResetToken((value) => value + 1);
        setStatus((prev) => ({
          ...prev,
          state: 'succeeded',
          activeGoalId: null,
          waypointIndex: 1,
          totalWaypoints: 1,
          updatedAt: Date.now(),
        }));
      },
      undefined,
      (error: string) => {
        if (!issuedGoalId || activeGoalRef.current?.id !== issuedGoalId) {
          return;
        }

        activeGoalRef.current = null;
        queueContextRef.current = null;
        setPathResetToken((value) => value + 1);
        setStatus((prev) => ({
          ...prev,
          state: cancelRequestedRef.current ? 'canceled' : 'failed',
          error,
          activeGoalId: null,
          waypointIndex: 0,
          updatedAt: Date.now(),
        }));
      },
    );

    if (!issuedGoalId) {
      throw new Error('NavigateToPose goal was rejected');
    }

    activeGoalRef.current = { id: issuedGoalId, mode };
    setStatus({
      mode,
      state: 'running',
      error: null,
      activeGoalId: issuedGoalId,
      iteration,
      waypointIndex: queueContextRef.current ? queueContextRef.current.currentIndex + 1 : 1,
      totalWaypoints: queueContextRef.current ? queueContextRef.current.poses.length : 1,
      updatedAt: Date.now(),
    });
  }, [frameId]);

  const startSingleGoal = useCallback(async (pose: NavigationPose) => {
    if (!ros || !isConnected) {
      throw new Error('Not connected to ROS');
    }

    cancelCurrentTask();
    cancelRequestedRef.current = false;
    queueContextRef.current = null;
    setPathResetToken((value) => value + 1);
    sendSingleGoal(pose, 'single', 1);
  }, [cancelCurrentTask, isConnected, ros, sendSingleGoal]);

  const startRoute = useCallback(async (poses: NavigationPose[]) => {
    if (!ros || !isConnected) {
      throw new Error('Not connected to ROS');
    }

    if (poses.length < 2) {
      throw new Error('至少需要 2 个途经点');
    }

    cancelCurrentTask();
    cancelRequestedRef.current = false;
    queueContextRef.current = {
      poses,
      currentIndex: 0,
      iteration: 1,
      mode: 'route',
    };
    setPathResetToken((value) => value + 1);
    sendSingleGoal(poses[0], 'route', 1);
  }, [cancelCurrentTask, isConnected, ros, sendSingleGoal]);

  const startLoop = useCallback(async (poses: NavigationPose[]) => {
    if (!ros || !isConnected) {
      throw new Error('Not connected to ROS');
    }

    if (poses.length < 2) {
      throw new Error('循环巡航至少需要 2 个点');
    }

    cancelCurrentTask();
    cancelRequestedRef.current = false;
    queueContextRef.current = {
      poses,
      currentIndex: 0,
      iteration: 1,
      mode: 'loop',
    };
    setPathResetToken((value) => value + 1);
    sendSingleGoal(poses[0], 'loop', 1);
  }, [cancelCurrentTask, isConnected, ros, sendSingleGoal]);

  return {
    status,
    isRunning: status.state === 'running',
    pathResetToken,
    startSingleGoal,
    startRoute,
    startLoop,
    cancelCurrentTask,
  };
}
