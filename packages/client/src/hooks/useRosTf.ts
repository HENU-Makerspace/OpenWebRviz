import { useState, useEffect } from 'react';
import * as ROSLIB from 'roslib';

export interface RobotPose {
  x: number;
  y: number;
  theta: number;
  frameId: string;
}

// Simple TF listener - directly update state on message
export function useRosTfTree(ros: ROSLIB.Ros | null, paused: boolean = false) {
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);

  useEffect(() => {
    if (!ros) {
      setRobotPose(null);
      return;
    }

    const tfSub = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/msg/TFMessage',
    });

    tfSub.subscribe((message: unknown) => {
      if (paused) return;

      const tfMsg = message as { transforms: Array<{
        header: { stamp: { sec: number; nsec: number }; frame_id: string; };
        child_frame_id: string;
        transform: { translation: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } };
      }> };

      if (!tfMsg.transforms) return;

      // Find robot frame - try multiple common names
      const commonFrames = ['base_link', 'base_footprint', 'robot_base', 'base', 'body'];

      for (const transform of tfMsg.transforms) {
        const childFrameId = transform.child_frame_id;

        if (commonFrames.includes(childFrameId)) {
          const translation = transform.transform.translation;
          const rotation = transform.transform.rotation;

          // Convert quaternion to theta
          const siny_cosp = 2 * (rotation.w * rotation.z + rotation.x * rotation.y);
          const cosy_cosp = 1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z);
          const theta = Math.atan2(siny_cosp, cosy_cosp);

          setRobotPose({
            x: translation.x,
            y: translation.y,
            theta,
            frameId: childFrameId,
          });
          break;
        }
      }
    });

    return () => {
      tfSub.unsubscribe();
      setRobotPose(null);
    };
  }, [ros, paused]);

  return { robotPose };
}

// Simple TF listener for single frame transform (alternative API)
export function useRosTf(
  ros: ROSLIB.Ros | null,
  targetFrame: string = 'map',
  sourceFrame: string = 'base_link',
  paused: boolean = false
) {
  const [robotPose, setRobotPose] = useState<RobotPose | null>(null);

  useEffect(() => {
    if (!ros) {
      setRobotPose(null);
      return;
    }

    const tfClient = new ROSLIB.TFClient({
      ros,
      fixedFrame: targetFrame,
      angularThres: 0.01,
      transThres: 0.01,
    });

    tfClient.subscribe(sourceFrame, (transform) => {
      if (paused) return;
      if (transform) {
        const siny_cosp = 2 * (transform.rotation.w * transform.rotation.z + transform.rotation.x * transform.rotation.y);
        const cosy_cosp = 1 - 2 * (transform.rotation.y * transform.rotation.y + transform.rotation.z * transform.rotation.z);
        const theta = Math.atan2(siny_cosp, cosy_cosp);

        setRobotPose({
          x: transform.translation.x,
          y: transform.translation.y,
          theta,
          frameId: sourceFrame,
        });
      }
    });

    return () => {
      tfClient.unsubscribe(sourceFrame);
      setRobotPose(null);
    };
  }, [ros, targetFrame, sourceFrame, paused]);

  return robotPose;
}
