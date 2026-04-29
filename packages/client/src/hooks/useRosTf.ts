import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';

export interface RobotPose {
  x: number;
  y: number;
  theta: number;
  frameId: string;
}

type TfTransform = {
  header: { stamp: { sec: number; nsec: number }; frame_id: string };
  child_frame_id: string;
  transform: {
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  };
};

type Pose2D = {
  x: number;
  y: number;
  theta: number;
};

function quatToYaw(q: { x: number; y: number; z: number; w: number }) {
  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(sinyCosp, cosyCosp);
}

function normalizeAngle(angle: number) {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}

function compose2D(a: Pose2D, b: Pose2D): Pose2D {
  const cosA = Math.cos(a.theta);
  const sinA = Math.sin(a.theta);

  return {
    x: a.x + cosA * b.x - sinA * b.y,
    y: a.y + sinA * b.x + cosA * b.y,
    theta: normalizeAngle(a.theta + b.theta),
  };
}

function invert2D(pose: Pose2D): Pose2D {
  const cosTheta = Math.cos(pose.theta);
  const sinTheta = Math.sin(pose.theta);

  return {
    x: -(cosTheta * pose.x + sinTheta * pose.y),
    y: -(-sinTheta * pose.x + cosTheta * pose.y),
    theta: normalizeAngle(-pose.theta),
  };
}

function tfToPose2D(tf: TfTransform): Pose2D {
  return {
    x: tf.transform.translation.x,
    y: tf.transform.translation.y,
    theta: quatToYaw(tf.transform.rotation),
  };
}

function normalizeFrameId(frameId: string) {
  return frameId.trim().replace(/^\/+/, '');
}

export function useRosTfTree(ros: ROSLIB.Ros | null, paused: boolean = false) {
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);
  const [tfVersion, setTfVersion] = useState(0);
  const tfCacheRef = useRef<Map<string, TfTransform>>(new Map());
  const rafRef = useRef<number | null>(null);
  const latestRobotPoseRef = useRef<RobotPose | null>(null);

  const makeKey = useCallback((parent: string, child: string) => `${parent}->${child}`, []);

  const resolvePoseInMap = useCallback((targetFrame: string): RobotPose | null => {
    const normalizedTargetFrame = normalizeFrameId(targetFrame);

    if (!normalizedTargetFrame) {
      return null;
    }

    if (normalizedTargetFrame === 'map') {
      return { x: 0, y: 0, theta: 0, frameId: 'map' };
    }

    const cache = tfCacheRef.current;
    if (cache.size === 0) {
      return null;
    }

    const visited = new Set<string>(['map']);
    const queue: Array<{ frame: string; pose: Pose2D }> = [{ frame: 'map', pose: { x: 0, y: 0, theta: 0 } }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.frame === normalizedTargetFrame) {
        return {
          x: current.pose.x,
          y: current.pose.y,
          theta: current.pose.theta,
          frameId: `map->${normalizedTargetFrame}`,
        };
      }

      for (const tf of cache.values()) {
        const parent = normalizeFrameId(tf.header.frame_id);
        const child = normalizeFrameId(tf.child_frame_id);
        const edgePose = tfToPose2D(tf);

        if (parent === current.frame && !visited.has(child)) {
          visited.add(child);
          queue.push({
            frame: child,
            pose: compose2D(current.pose, edgePose),
          });
        }

        if (child === current.frame && !visited.has(parent)) {
          visited.add(parent);
          queue.push({
            frame: parent,
            pose: compose2D(current.pose, invert2D(edgePose)),
          });
        }
      }
    }

    return null;
  }, []);

  useEffect(() => {
    if (!ros) {
      setRobotPose(null);
      setTfVersion(0);
      tfCacheRef.current.clear();
      return;
    }

    const tfSub = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/msg/TFMessage',
    });

    const tfStaticSub = new ROSLIB.Topic({
      ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/msg/TFMessage',
    });

    const flushLatest = () => {
      rafRef.current = null;

      const baseLinkPose = resolvePoseInMap('base_link');
      const bodyPose = resolvePoseInMap('body');
      const cameraInitPose = resolvePoseInMap('camera_init');
      const nextPose = baseLinkPose || bodyPose || cameraInitPose;

      latestRobotPoseRef.current = nextPose;
      setRobotPose(nextPose);
      setTfVersion((value) => value + 1);
    };

    const scheduleFlush = () => {
      if (rafRef.current != null) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(flushLatest);
    };

    const updateCache = (message: unknown) => {
      if (paused) return;

      const tfMsg = message as { transforms: TfTransform[] };
      if (!tfMsg.transforms || tfMsg.transforms.length === 0) return;

      for (const tf of tfMsg.transforms) {
        tfCacheRef.current.set(
          makeKey(normalizeFrameId(tf.header.frame_id), normalizeFrameId(tf.child_frame_id)),
          tf
        );
      }

      scheduleFlush();
    };

    tfSub.subscribe(updateCache);
    tfStaticSub.subscribe(updateCache);

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tfSub.unsubscribe();
      tfStaticSub.unsubscribe();
      setRobotPose(null);
      setTfVersion(0);
      tfCacheRef.current.clear();
    };
  }, [makeKey, paused, resolvePoseInMap, ros]);

  return { robotPose, resolvePoseInMap, tfVersion };
}
