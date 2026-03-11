import { useEffect, useRef, useCallback } from 'react';
import * as ROSLIB from 'roslib';

interface TeleopSettings {
  linearSpeed: number;
  angularSpeed: number;
  cmdVelTopic: string;
}

export function useKeyboardTeleop(
  ros: ROSLIB.Ros | null,
  settings: TeleopSettings = { linearSpeed: 0.5, angularSpeed: 1.0, cmdVelTopic: '/cmd_vel' },
  enabled: boolean = true
) {
  const cmdVelPubRef = useRef<any>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const animationFrameRef = useRef<number | null>(null);

  // Initialize publisher
  useEffect(() => {
    if (!ros || !enabled) return;

    cmdVelPubRef.current = new ROSLIB.Topic({
      ros,
      name: settings.cmdVelTopic,
      messageType: 'geometry_msgs/msg/Twist',
    });

    console.log('[useKeyboardTeleop] Publisher initialized for', settings.cmdVelTopic);

    return () => {
      if (cmdVelPubRef.current) {
        cmdVelPubRef.current.unadvertise();
        cmdVelPubRef.current = null;
      }
    };
  }, [ros, settings.cmdVelTopic, enabled]);

  // Publish velocity command
  const publishCmdVel = useCallback(() => {
    if (!cmdVelPubRef.current || !enabled) return;

    const pressed = pressedKeysRef.current;
    let linear = 0;
    let angular = 0;

    // Forward/backward (W/S or Arrow Up/Down)
    if (pressed.has('KeyW') || pressed.has('ArrowUp')) {
      linear = settings.linearSpeed;
    }
    if (pressed.has('KeyS') || pressed.has('ArrowDown')) {
      linear = -settings.linearSpeed;
    }

    // Left/right rotation (A/D or Arrow Left/Right)
    if (pressed.has('KeyA') || pressed.has('ArrowLeft')) {
      angular = settings.angularSpeed;
    }
    if (pressed.has('KeyD') || pressed.has('ArrowRight')) {
      angular = -settings.angularSpeed;
    }

    // Only publish if there's movement
    if (linear !== 0 || angular !== 0) {
      const now = Date.now();
      const msg = {
        header: {
          stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1000000 },
          frame_id: 'base_link',
        },
        twist: {
          linear: { x: linear, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: angular },
        },
      };
      console.log('[useKeyboardTeleop] Publishing:', linear, angular);
      cmdVelPubRef.current.publish(msg);
    }
  }, [settings.linearSpeed, settings.angularSpeed, enabled]);

  // Animation loop for continuous publishing
  const startPublishing = useCallback(() => {
    if (animationFrameRef.current) return;

    const loop = () => {
      publishCmdVel();
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
  }, [publishCmdVel]);

  const stopPublishing = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Set up keyboard event listeners
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      pressedKeysRef.current.add(e.code);
      startPublishing();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.code);

      if (pressedKeysRef.current.size === 0) {
        stopPublishing();
        // Send stop command
        if (cmdVelPubRef.current) {
          const now = Date.now();
          const msg = {
            header: {
              stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1000000 },
              frame_id: '',
            },
            twist: {
              linear: { x: 0, y: 0, z: 0 },
              angular: { x: 0, y: 0, z: 0 },
            },
          };
          cmdVelPubRef.current.publish(msg);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      stopPublishing();
      // Send stop command on cleanup
      if (cmdVelPubRef.current) {
        const now = Date.now();
        const msg = {
          header: {
            stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1000000 },
            frame_id: '',
          },
          twist: {
            linear: { x: 0, y: 0, z: 0 },
            angular: { x: 0, y: 0, z: 0 },
          },
        };
        cmdVelPubRef.current.publish(msg);
      }
    };
  }, [enabled, startPublishing, stopPublishing]);

  return {
    isActive: enabled,
    settings,
  };
}
