import { useEffect, useRef, useCallback } from 'react';
import * as ROSLIB from 'roslib';

interface TeleopSettings {
  linearSpeed: number;
  angularSpeed: number;
  cmdVelTopic: string;
  publishRateHz?: number;
}

export function useKeyboardTeleop(
  ros: ROSLIB.Ros | null,
  settings: TeleopSettings = { linearSpeed: 0.5, angularSpeed: 1.0, cmdVelTopic: '/cmd_vel', publishRateHz: 15 },
  enabled: boolean = true
) {
  const cmdVelPubRef = useRef<any>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const publishTimerRef = useRef<number | null>(null);
  const lastPublishedRef = useRef<{ linear: number; angular: number } | null>(null);

  const sendCommand = useCallback((linear: number, angular: number) => {
    if (!cmdVelPubRef.current || !enabled) return;

    const lastPublished = lastPublishedRef.current;
    if (lastPublished && lastPublished.linear === linear && lastPublished.angular === angular) {
      return;
    }

    const msg = {
      linear: { x: linear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    };

    cmdVelPubRef.current.publish(msg);
    lastPublishedRef.current = { linear, angular };
    console.log('[useKeyboardTeleop] Published /cmd_vel:', { linear, angular });
  }, [enabled]);

  const sendStop = useCallback(() => {
    sendCommand(0, 0);
  }, [sendCommand]);

  // Initialize publisher
  useEffect(() => {
    if (!ros || !enabled) return;

    cmdVelPubRef.current = new ROSLIB.Topic({
      ros,
      name: settings.cmdVelTopic,
      messageType: 'geometry_msgs/msg/Twist',
      queue_size: 1,
    });

    console.log('[useKeyboardTeleop] Publisher initialized for', settings.cmdVelTopic);

    return () => {
      sendStop();
      if (cmdVelPubRef.current) {
        cmdVelPubRef.current.unadvertise();
        cmdVelPubRef.current = null;
      }
      lastPublishedRef.current = null;
    };
  }, [ros, settings.cmdVelTopic, enabled, sendStop]);

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

    sendCommand(linear, angular);
  }, [settings.linearSpeed, settings.angularSpeed, enabled, sendCommand]);

  // Fixed-rate publishing is much gentler on rosbridge than requestAnimationFrame.
  const startPublishing = useCallback(() => {
    if (publishTimerRef.current) return;

    publishCmdVel();
    const intervalMs = Math.max(50, Math.round(1000 / (settings.publishRateHz || 15)));
    publishTimerRef.current = window.setInterval(() => {
      publishCmdVel();
    }, intervalMs);
  }, [publishCmdVel, settings.publishRateHz]);

  const stopPublishing = useCallback(() => {
    if (publishTimerRef.current) {
      window.clearInterval(publishTimerRef.current);
      publishTimerRef.current = null;
    }
  }, []);

  // Set up keyboard event listeners
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        return;
      }

      e.preventDefault();
      pressedKeysRef.current.add(e.code);
      startPublishing();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        return;
      }

      e.preventDefault();
      pressedKeysRef.current.delete(e.code);

      if (pressedKeysRef.current.size === 0) {
        stopPublishing();
        sendStop();
      }
    };

    const handleWindowBlur = () => {
      pressedKeysRef.current.clear();
      stopPublishing();
      sendStop();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleWindowBlur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pressedKeysRef.current.clear();
      stopPublishing();
      sendStop();
    };
  }, [enabled, sendStop, startPublishing, stopPublishing]);

  return {
    isActive: enabled,
    settings,
  };
}
