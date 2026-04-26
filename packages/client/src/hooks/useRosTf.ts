import { useState, useEffect, useRef } from 'react';
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

function quatToYaw(q: { x: number; y: number; z: number; w: number }) {
  const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
  const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(siny_cosp, cosy_cosp);
}

function normalizeAngle(angle: number) {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function compose2D(
  a: { x: number; y: number; theta: number },
  b: { x: number; y: number; theta: number }
) {
  const cosA = Math.cos(a.theta);
  const sinA = Math.sin(a.theta);

  return {
    x: a.x + cosA * b.x - sinA * b.y,
    y: a.y + sinA * b.x + cosA * b.y,
    theta: normalizeAngle(a.theta + b.theta),
  };
}

export function useRosTfTree(ros: ROSLIB.Ros | null, paused: boolean = false) {
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);

  // 关键：缓存最近收到的 TF 边
  const tfCacheRef = useRef<Map<string, TfTransform>>(new Map());
  const rafRef = useRef<number | null>(null);
  const latestPoseRef = useRef<RobotPose | null>(null);

  useEffect(() => {
    if (!ros) {
      setRobotPose(null);
      tfCacheRef.current.clear();
      return;
    }

    const tfSub = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/msg/TFMessage',
    });

    const makeKey = (parent: string, child: string) => `${parent}->${child}`;

    tfSub.subscribe((message: unknown) => {
      if (paused) return;

      const tfMsg = message as { transforms: TfTransform[] };
      if (!tfMsg.transforms || tfMsg.transforms.length === 0) return;

      // 更新缓存
      for (const tf of tfMsg.transforms) {
        const key = makeKey(tf.header.frame_id, tf.child_frame_id);
        tfCacheRef.current.set(key, tf);
      }

      const getTf = (parent: string, child: string) =>
        tfCacheRef.current.get(makeKey(parent, child));

      const mapToCameraInit = getTf('map', 'camera_init');
      const cameraInitToBody = getTf('camera_init', 'body');
      const bodyToBaseLink = getTf('body', 'base_link');
      const commitLatestPose = () => {
        rafRef.current = null;
        if (latestPoseRef.current) {
          setRobotPose(latestPoseRef.current);
        }
      };

      // 优先合成 map -> body / map -> base_link
      if (mapToCameraInit && cameraInitToBody) {
        const a = {
          x: mapToCameraInit.transform.translation.x,
          y: mapToCameraInit.transform.translation.y,
          theta: quatToYaw(mapToCameraInit.transform.rotation),
        };

        const b = {
          x: cameraInitToBody.transform.translation.x,
          y: cameraInitToBody.transform.translation.y,
          theta: quatToYaw(cameraInitToBody.transform.rotation),
        };

        const mapToBody = compose2D(a, b);

        if (bodyToBaseLink) {
          const c = {
            x: bodyToBaseLink.transform.translation.x,
            y: bodyToBaseLink.transform.translation.y,
            theta: quatToYaw(bodyToBaseLink.transform.rotation),
          };

          const mapToBaseLink = compose2D(mapToBody, c);

          latestPoseRef.current = {
            x: mapToBaseLink.x,
            y: mapToBaseLink.y,
            theta: mapToBaseLink.theta,
            frameId: 'map->base_link',
          };
          if (rafRef.current == null) {
            rafRef.current = window.requestAnimationFrame(commitLatestPose);
          }
          return;
        }

        latestPoseRef.current = {
          x: mapToBody.x,
          y: mapToBody.y,
          theta: mapToBody.theta,
          frameId: 'map->body',
        };
        if (rafRef.current == null) {
          rafRef.current = window.requestAnimationFrame(commitLatestPose);
        }
        return;
      }

      // 没有 map->camera_init 时，退回到局部 pose
      if (cameraInitToBody) {
        latestPoseRef.current = {
          x: cameraInitToBody.transform.translation.x,
          y: cameraInitToBody.transform.translation.y,
          theta: quatToYaw(cameraInitToBody.transform.rotation),
          frameId: 'camera_init->body',
        };
        if (rafRef.current == null) {
          rafRef.current = window.requestAnimationFrame(commitLatestPose);
        }
      }
    });

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tfSub.unsubscribe();
      setRobotPose(null);
      tfCacheRef.current.clear();
    };
  }, [ros, paused]);

  return { robotPose };
}
