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
  const [pathResetToken, setPathResetToken] = useState(0);

  const navigateToPoseActionRef = useRef<ROSLIB.Action<any, any, any> | null>(null);
  const navigateThroughPosesActionRef = useRef<ROSLIB.Action<any, any, any> | null>(null);
  const activeGoalRef = useRef<{ id: string; mode: NavigationTaskMode } | null>(null);
  const loopContextRef = useRef<{ poses: NavigationPose[]; iteration: number } | null>(null);
  const cancelRequestedRef = useRef(false);

  const frameId = config?.frameId || 'map';
  const navigateToPoseActionName = config?.navigateToPoseAction || '/navigate_to_pose';
  const navigateToPoseActionType = config?.navigateToPoseType || 'nav2_msgs/action/NavigateToPose';
  const navigateThroughPosesActionName = config?.navigateThroughPosesAction || '/navigate_through_poses';
  const navigateThroughPosesActionType = config?.navigateThroughPosesType || 'nav2_msgs/action/NavigateThroughPoses';

  useEffect(() => {
    activeGoalRef.current = null;
    loopContextRef.current = null;
    cancelRequestedRef.current = false;

    if (!ros || !isConnected) {
      navigateToPoseActionRef.current = null;
      navigateThroughPosesActionRef.current = null;
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

    navigateThroughPosesActionRef.current = new ROSLIB.Action({
      ros,
      name: navigateThroughPosesActionName,
      actionType: navigateThroughPosesActionType,
    });

    return () => {
      navigateToPoseActionRef.current = null;
      navigateThroughPosesActionRef.current = null;
      activeGoalRef.current = null;
      loopContextRef.current = null;
      cancelRequestedRef.current = false;
    };
  }, [
    isConnected,
    navigateThroughPosesActionName,
    navigateThroughPosesActionType,
    navigateToPoseActionName,
    navigateToPoseActionType,
    ros,
  ]);

  const cancelCurrentTask = useCallback(() => {
    cancelRequestedRef.current = true;

    const activeGoal = activeGoalRef.current;
    if (activeGoal?.id) {
      if (activeGoal.mode === 'single') {
        navigateToPoseActionRef.current?.cancelGoal(activeGoal.id);
      } else {
        navigateThroughPosesActionRef.current?.cancelGoal(activeGoal.id);
      }
    }

    activeGoalRef.current = null;
    loopContextRef.current = null;
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

        if (loopContextRef.current && !cancelRequestedRef.current) {
          const nextIteration = loopContextRef.current.iteration + 1;
          loopContextRef.current = {
            poses: loopContextRef.current.poses,
            iteration: nextIteration,
          };
          sendSingleGoal(loopContextRef.current.poses[0], 'loop', nextIteration);
          return;
        }

        activeGoalRef.current = null;
        setPathResetToken((value) => value + 1);
        setStatus((prev) => ({
          ...prev,
          state: 'succeeded',
          activeGoalId: null,
          waypointIndex: prev.totalWaypoints > 0 ? prev.totalWaypoints : 1,
          updatedAt: Date.now(),
        }));
      },
      undefined,
      (error: string) => {
        if (!issuedGoalId || activeGoalRef.current?.id !== issuedGoalId) {
          return;
        }

        activeGoalRef.current = null;
        loopContextRef.current = null;
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
      waypointIndex: 1,
      totalWaypoints: 1,
      updatedAt: Date.now(),
    });
  }, [frameId]);

  const sendRouteGoal = useCallback((poses: NavigationPose[], mode: NavigationTaskMode, iteration: number) => {
    if (!navigateThroughPosesActionRef.current) {
      throw new Error('NavigateThroughPoses action is not ready');
    }

    let issuedGoalId: string | undefined;

    issuedGoalId = navigateThroughPosesActionRef.current.sendGoal(
      {
        poses: poses.map((pose) => toPoseStamped(pose, frameId)),
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

        if (loopContextRef.current && !cancelRequestedRef.current) {
          const nextIteration = loopContextRef.current.iteration + 1;
          loopContextRef.current = {
            poses: loopContextRef.current.poses,
            iteration: nextIteration,
          };
          sendRouteGoal(loopContextRef.current.poses, 'loop', nextIteration);
          return;
        }

        activeGoalRef.current = null;
        setPathResetToken((value) => value + 1);
        setStatus((prev) => ({
          ...prev,
          state: 'succeeded',
          activeGoalId: null,
          waypointIndex: prev.totalWaypoints,
          updatedAt: Date.now(),
        }));
      },
      undefined,
      (error: string) => {
        if (!issuedGoalId || activeGoalRef.current?.id !== issuedGoalId) {
          return;
        }

        activeGoalRef.current = null;
        loopContextRef.current = null;
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
      throw new Error('NavigateThroughPoses goal was rejected');
    }

    activeGoalRef.current = { id: issuedGoalId, mode };
    setStatus({
      mode,
      state: 'running',
      error: null,
      activeGoalId: issuedGoalId,
      iteration,
      waypointIndex: poses.length > 0 ? 1 : 0,
      totalWaypoints: poses.length,
      updatedAt: Date.now(),
    });
  }, [frameId]);

  const startSingleGoal = useCallback(async (pose: NavigationPose) => {
    if (!ros || !isConnected) {
      throw new Error('Not connected to ROS');
    }

    cancelCurrentTask();
    cancelRequestedRef.current = false;
    loopContextRef.current = null;
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
    loopContextRef.current = null;
    setPathResetToken((value) => value + 1);
    sendRouteGoal(poses, 'route', 1);
  }, [cancelCurrentTask, isConnected, ros, sendRouteGoal]);

  const startLoop = useCallback(async (poses: NavigationPose[]) => {
    if (!ros || !isConnected) {
      throw new Error('Not connected to ROS');
    }

    if (poses.length < 2) {
      throw new Error('循环巡航至少需要 2 个点');
    }

    cancelCurrentTask();
    cancelRequestedRef.current = false;
    loopContextRef.current = { poses, iteration: 1 };
    setPathResetToken((value) => value + 1);
    sendRouteGoal(poses, 'loop', 1);
  }, [cancelCurrentTask, isConnected, ros, sendRouteGoal]);

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
