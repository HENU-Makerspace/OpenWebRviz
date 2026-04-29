import { useEffect, useRef, useCallback, useState } from 'react';
import * as ROSLIB from 'roslib';

interface TeleopSettings {
  linearSpeed: number;
  angularSpeed: number;
  motionCmdTopic: string;
  standMode: boolean;
  up: number;
  publishRateHz?: number;
}

export function useKeyboardTeleop(
  ros: ROSLIB.Ros | null,
  settings: TeleopSettings = {
    linearSpeed: 0.5,
    angularSpeed: 1.0,
    motionCmdTopic: '/diablo/MotionCmd',
    standMode: false,
    up: 0.0,
    publishRateHz: 25,
  },
  enabled: boolean = true
) {
  const motionCmdPubRef = useRef<any>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const publishTimerRef = useRef<number | null>(null);
  const [standMode, setStandMode] = useState(settings.standMode);

  useEffect(() => {
    setStandMode(settings.standMode);
  }, [settings.standMode]);

  const sendCommand = useCallback((linear: number, angular: number, nextStandMode = standMode) => {
    if (!motionCmdPubRef.current || !enabled) return;

    const msg = {
      mode_mark: false,
      mode: {
        stand_mode: nextStandMode,
        pitch_ctrl_mode: false,
        roll_ctrl_mode: false,
        height_ctrl_mode: true,
        jump_mode: false,
        split_mode: false,
      },
      value: {
        forward: linear,
        left: angular,
        up: nextStandMode ? 1.0 : 0.0,
        roll: 0.0,
        pitch: 0.0,
        leg_split: 0.0,
      },
    };

    motionCmdPubRef.current.publish(msg);
    console.log('[useKeyboardTeleop] Published /diablo/MotionCmd:', { linear, angular, standMode: nextStandMode });
  }, [enabled, standMode]);

  const sendStop = useCallback(() => {
    sendCommand(0, 0);
  }, [sendCommand]);

  const sendStanceCommand = useCallback((nextStandMode: boolean) => {
    setStandMode(nextStandMode);
    for (let i = 0; i < 3; i += 1) {
      window.setTimeout(() => sendCommand(0, 0, nextStandMode), i * 60);
    }
  }, [sendCommand]);

  // Initialize publisher
  useEffect(() => {
    if (!ros || !enabled) return;

    motionCmdPubRef.current = new ROSLIB.Topic({
      ros,
      name: settings.motionCmdTopic,
      messageType: 'motion_msgs/msg/MotionCtrl',
      queue_size: 1,
    });

    console.log('[useKeyboardTeleop] Publisher initialized for', settings.motionCmdTopic);

    return () => {
      sendStop();
      if (motionCmdPubRef.current) {
        motionCmdPubRef.current.unadvertise();
        motionCmdPubRef.current = null;
      }
    };
  }, [ros, settings.motionCmdTopic, enabled, sendStop]);

  // Publish Diablo motion command directly in the same direction mapping the Jetson bridge used.
  const publishCmdVel = useCallback(() => {
    if (!motionCmdPubRef.current || !enabled) return;

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

      if (e.code === 'KeyZ') {
        if (!e.repeat) {
          e.preventDefault();
          sendStanceCommand(!standMode);
        }
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
  }, [enabled, sendStanceCommand, sendStop, standMode, startPublishing, stopPublishing]);

  return {
    isActive: enabled,
    settings: {
      ...settings,
      standMode,
      up: standMode ? 1.0 : 0.0,
    },
  };
}
