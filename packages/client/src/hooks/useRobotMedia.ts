import { useCallback, useEffect, useRef, useState } from 'react';

export interface MediaConfig {
  janusBaseUrl: string;
  janusApiUrl: string;
  janusDemoBaseUrl: string;
  janusScriptUrl: string;
  streamingUrl: string;
  audioBridgeUrl: string;
  preferredVideoStreamId: number;
  preferredAudioStreamId: number;
  audioBridgeRoom: number;
  audioBridgeDisplay: string;
}

interface MediaServiceStatus {
  janus: boolean;
}

interface MediaStatusResponse {
  janus: boolean;
  talkbackForward: {
    active: boolean;
    streamId: number | null;
  };
}

interface JanusStreamInfo {
  id: number;
  description?: string;
  media?: Array<{ type?: string }>;
  audio?: boolean;
  video?: boolean;
}

declare global {
  interface Window {
    Janus?: any;
    adapter?: any;
  }
}

const scriptCache = new Map<string, Promise<void>>();
let janusInitPromise: Promise<void> | null = null;
const ADAPTER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/webrtc-adapter/9.0.3/adapter.min.js';

function loadScript(src: string) {
  if (scriptCache.has(src)) {
    return scriptCache.get(src)!;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  scriptCache.set(src, promise);
  return promise;
}

async function ensureJanusRuntime(config: MediaConfig) {
  await loadScript(ADAPTER_CDN_URL);
  await loadScript(config.janusScriptUrl);

  if (!window.Janus) {
    throw new Error('Janus runtime was not loaded');
  }

  if (!janusInitPromise) {
    janusInitPromise = new Promise<void>((resolve) => {
      window.Janus.init({
        debug: false,
        dependencies: window.Janus.useDefaultDependencies
          ? window.Janus.useDefaultDependencies({ adapter: window.adapter })
          : undefined,
        callback: () => resolve(),
      });
    });
  }

  return janusInitPromise;
}

function pickStream(
  streams: JanusStreamInfo[],
  kind: 'video' | 'audio',
  preferredId: number,
) {
  if (preferredId > 0) {
    return streams.find((stream) => stream.id === preferredId) || null;
  }

  if (kind === 'video') {
    return streams.find((stream) => {
      const media = stream.media || [];
      return media.some((item) => item.type === 'video') || stream.video;
    }) || null;
  }

  return streams.find((stream) => {
    const media = stream.media || [];
    const hasAudio = media.some((item) => item.type === 'audio') || stream.audio;
    const hasVideo = media.some((item) => item.type === 'video') || stream.video;
    return hasAudio && !hasVideo;
  }) || streams.find((stream) => {
    const media = stream.media || [];
    return media.some((item) => item.type === 'audio') || stream.audio;
  }) || null;
}

export function useRobotMedia(config: MediaConfig | null) {
  const [serviceStatus, setServiceStatus] = useState<MediaServiceStatus>({
    janus: false,
  });
  const [talkbackForwardActive, setTalkbackForwardActive] = useState(false);
  const [videoConnected, setVideoConnected] = useState(false);
  const [audioConnected, setAudioConnected] = useState(false);
  const [talkbackActive, setTalkbackActive] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const janusRef = useRef<any>(null);
  const videoHandleRef = useRef<any>(null);
  const audioHandleRef = useRef<any>(null);
  const talkbackHandleRef = useRef<any>(null);
  const remoteVideoStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioStreamRef = useRef<MediaStream | null>(null);
  const localTalkbackStreamRef = useRef<MediaStream | null>(null);
  const talkbackJoinedRef = useRef(false);

  const clearMediaElement = useCallback((element: HTMLMediaElement | null) => {
    if (!element) {
      return;
    }

    element.pause();
    element.srcObject = null;
  }, []);

  const bindMediaElement = useCallback(async (element: HTMLMediaElement | null, stream: MediaStream | null) => {
    if (!element || !stream) {
      return;
    }

    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }

    try {
      await element.play();
    } catch {
      // Browsers can block autoplay until the user clicks a button again.
    }
  }, []);

  const stopTracks = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const destroySessionIfIdle = useCallback(() => {
    if (!janusRef.current || videoHandleRef.current || audioHandleRef.current || talkbackHandleRef.current) {
      return;
    }

    janusRef.current.destroy({
      cleanupHandles: true,
      success: () => {
        janusRef.current = null;
      },
      error: () => {
        janusRef.current = null;
      },
    });
  }, []);

  const requestJson = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.details || data?.error || `Request failed: ${response.status}`);
    }

    return data as T;
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!config) {
      return null;
    }

    try {
      const response = await requestJson<MediaStatusResponse>('/api/media/status');
      setServiceStatus({ janus: response.janus });
      setTalkbackForwardActive(response.talkbackForward.active);
      return response;
    } catch (err) {
      setServiceStatus({ janus: false });
      setTalkbackForwardActive(false);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [config, requestJson]);

  const ensureSession = useCallback(async () => {
    if (!config) {
      throw new Error('Media configuration is missing');
    }

    await ensureJanusRuntime(config);

    if (janusRef.current) {
      return janusRef.current;
    }

    janusRef.current = await new Promise<any>((resolve, reject) => {
      const janus = new window.Janus({
        server: config.janusApiUrl,
        success: () => resolve(janus),
        error: (err: unknown) => reject(err),
        destroyed: () => {
          janusRef.current = null;
        },
      });
    });

    return janusRef.current;
  }, [config]);

  const attachPlugin = useCallback(async (plugin: string, options: Record<string, unknown>) => {
    const janus = await ensureSession();

    return new Promise<any>((resolve, reject) => {
      janus.attach({
        plugin,
        opaqueId: `webbot-${plugin}-${Math.random().toString(36).slice(2, 8)}`,
        success: (pluginHandle: unknown) => resolve(pluginHandle),
        error: (err: unknown) => reject(err),
        ...options,
      });
    });
  }, [ensureSession]);

  const pluginMessage = useCallback(async (handle: any, message: Record<string, unknown>) => {
    return new Promise<any>((resolve, reject) => {
      handle.send({
        message,
        success: (response: unknown) => resolve(response),
        error: (err: unknown) => reject(err),
      });
    });
  }, []);

  const stopVideo = useCallback(() => {
    if (videoHandleRef.current) {
      try {
        videoHandleRef.current.send({ message: { request: 'stop' } });
      } catch {}
      try {
        videoHandleRef.current.hangup();
      } catch {}
      try {
        videoHandleRef.current.detach();
      } catch {}
      videoHandleRef.current = null;
    }

    stopTracks(remoteVideoStreamRef.current);
    remoteVideoStreamRef.current = null;
    setVideoConnected(false);
    clearMediaElement(videoRef.current);
    destroySessionIfIdle();
  }, [clearMediaElement, destroySessionIfIdle, stopTracks]);

  const stopAudioMonitor = useCallback(() => {
    if (audioHandleRef.current) {
      try {
        audioHandleRef.current.send({ message: { request: 'stop' } });
      } catch {}
      try {
        audioHandleRef.current.hangup();
      } catch {}
      try {
        audioHandleRef.current.detach();
      } catch {}
      audioHandleRef.current = null;
    }

    stopTracks(remoteAudioStreamRef.current);
    remoteAudioStreamRef.current = null;
    setAudioConnected(false);
    clearMediaElement(audioRef.current);
    destroySessionIfIdle();
  }, [clearMediaElement, destroySessionIfIdle, stopTracks]);

  const stopTalkback = useCallback(async () => {
    if (talkbackHandleRef.current) {
      try {
        talkbackHandleRef.current.send({ message: { request: 'leave' } });
      } catch {}
      try {
        talkbackHandleRef.current.hangup();
      } catch {}
      try {
        talkbackHandleRef.current.detach();
      } catch {}
      talkbackHandleRef.current = null;
    }

    stopTracks(localTalkbackStreamRef.current);
    localTalkbackStreamRef.current = null;
    talkbackJoinedRef.current = false;
    setTalkbackActive(false);
    destroySessionIfIdle();

    if (config) {
      try {
        await requestJson('/api/media/talkback/forward/stop', { method: 'POST' });
        setTalkbackForwardActive(false);
        await refreshStatus();
      } catch {
        // Keep the browser cleanup successful even if forwarder cleanup fails.
      }
    }
  }, [config, destroySessionIfIdle, refreshStatus, requestJson, stopTracks]);

  const stopAll = useCallback(async () => {
    setLoadingAction('stop-all');
    stopVideo();
    stopAudioMonitor();
    await stopTalkback();
    await refreshStatus();
    setError(null);
    setLoadingAction(null);
  }, [refreshStatus, stopAudioMonitor, stopTalkback, stopVideo]);

  const connectStreaming = useCallback(async (kind: 'video' | 'audio') => {
    if (!config) {
      throw new Error('Media configuration is missing');
    }
    const status = await refreshStatus();
    if (status && !status.janus) {
      throw new Error('Janus is unavailable. Please make sure Janus and the Jetson media pipelines are already running.');
    }

    if (kind === 'video') {
      stopVideo();
    } else {
      stopAudioMonitor();
    }

    const handle = await attachPlugin('janus.plugin.streaming', {
      onmessage: (msg: any, jsep: any) => {
        const activeHandle = kind === 'video' ? videoHandleRef.current : audioHandleRef.current;
        if (!activeHandle) {
          return;
        }

        if (msg?.error) {
          setError(String(msg.error));
        }

        if (jsep) {
          activeHandle.createAnswer({
            jsep,
            tracks: [
              { type: 'data' },
            ],
            success: (answerJsep: unknown) => {
              activeHandle.send({
                message: { request: 'start' },
                jsep: answerJsep,
              });
            },
            error: (err: unknown) => {
              setError(`Failed to start ${kind} stream: ${String(err)}`);
            },
          });
        }
      },
      onremotestream: (stream: MediaStream) => {
        if (kind === 'video') {
          remoteVideoStreamRef.current = stream;
          void bindMediaElement(videoRef.current, stream);
          setVideoConnected(true);
          return;
        }

        remoteAudioStreamRef.current = stream;
        void bindMediaElement(audioRef.current, stream);
        setAudioConnected(true);
      },
      onremotetrack: (track: MediaStreamTrack, _mid: string, on: boolean) => {
        const targetRef = kind === 'video' ? remoteVideoStreamRef : remoteAudioStreamRef;
        const stream = targetRef.current || new MediaStream();
        targetRef.current = stream;

        if (on) {
          const exists = stream.getTracks().some((existingTrack) => existingTrack.id === track.id);
          if (!exists) {
            stream.addTrack(track);
          }
        } else {
          stream.getTracks()
            .filter((existingTrack) => existingTrack.id === track.id)
            .forEach((existingTrack) => {
              stream.removeTrack(existingTrack);
              existingTrack.stop();
            });
        }

        if (kind === 'video') {
          void bindMediaElement(videoRef.current, stream);
          setVideoConnected(stream.getVideoTracks().length > 0 || stream.getAudioTracks().length > 0);
          return;
        }

        void bindMediaElement(audioRef.current, stream);
        setAudioConnected(stream.getAudioTracks().length > 0);
      },
      oncleanup: () => {
        if (kind === 'video') {
          clearMediaElement(videoRef.current);
          setVideoConnected(false);
          return;
        }

        clearMediaElement(audioRef.current);
        setAudioConnected(false);
      },
    });

    const listing = await pluginMessage(handle, { request: 'list' });
    const streams = (listing?.list || listing?.streams || []) as JanusStreamInfo[];
    const selected = pickStream(
      streams,
      kind,
      kind === 'video' ? config.preferredVideoStreamId : config.preferredAudioStreamId,
    );

    if (!selected) {
      try {
        handle.detach();
      } catch {}
      throw new Error(kind === 'video' ? 'No video stream found on Janus' : 'No audio stream found on Janus');
    }

    if (kind === 'video') {
      videoHandleRef.current = handle;
    } else {
      audioHandleRef.current = handle;
    }

    await pluginMessage(handle, {
      request: 'watch',
      id: selected.id,
    });
  }, [
    attachPlugin,
    bindMediaElement,
    clearMediaElement,
    config,
    pluginMessage,
    refreshStatus,
    stopAudioMonitor,
    stopVideo,
  ]);

  const startVideo = useCallback(async () => {
    setLoadingAction('video');
    setError(null);
    try {
      await connectStreaming('video');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      stopVideo();
    } finally {
      setLoadingAction(null);
    }
  }, [connectStreaming, stopVideo]);

  const startAudioMonitor = useCallback(async () => {
    setLoadingAction('audio');
    setError(null);
    try {
      await connectStreaming('audio');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      stopAudioMonitor();
    } finally {
      setLoadingAction(null);
    }
  }, [connectStreaming, stopAudioMonitor]);

  const startTalkback = useCallback(async () => {
    if (!config) {
      return;
    }

    setLoadingAction('talkback');
    setError(null);

    try {
      await stopTalkback();
      const status = await refreshStatus();
      if (status && !status.janus) {
        throw new Error('Janus is unavailable. Please make sure Janus and the Jetson media pipelines are already running.');
      }
      await requestJson('/api/media/talkback/forward/start', { method: 'POST' });
      setTalkbackForwardActive(true);
      await refreshStatus();
      await ensureJanusRuntime(config);

      const handle = await attachPlugin('janus.plugin.audiobridge', {
        onmessage: (msg: any, jsep: any) => {
          if (msg?.error) {
            setError(String(msg.error));
          }

          const joined = msg?.audiobridge === 'joined' || Boolean(msg?.id) || Boolean(msg?.participants);

          if (joined && !talkbackJoinedRef.current) {
            talkbackJoinedRef.current = true;
            handle.createOffer({
              tracks: [
                { type: 'audio', capture: true, recv: true },
              ],
              success: (offerJsep: unknown) => {
                handle.send({
                  message: {
                    request: 'configure',
                    muted: false,
                  },
                  jsep: offerJsep,
                });
                setTalkbackActive(true);
              },
              error: (err: unknown) => {
                setError(`Failed to start talkback: ${String(err)}`);
              },
            });
          }

          if (jsep) {
            handle.handleRemoteJsep({ jsep });
          }
        },
        onlocalstream: (stream: MediaStream) => {
          localTalkbackStreamRef.current = stream;
        },
        onlocaltrack: (track: MediaStreamTrack, _on: boolean) => {
          const stream = localTalkbackStreamRef.current || new MediaStream();
          localTalkbackStreamRef.current = stream;
          const exists = stream.getTracks().some((existingTrack) => existingTrack.id === track.id);
          if (!exists) {
            stream.addTrack(track);
          }
        },
        oncleanup: () => {
          setTalkbackActive(false);
        },
      });

      talkbackHandleRef.current = handle;

      await pluginMessage(handle, {
        request: 'join',
        room: config.audioBridgeRoom,
        display: config.audioBridgeDisplay,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await stopTalkback();
    } finally {
      setLoadingAction(null);
    }
  }, [
    attachPlugin,
    config,
    pluginMessage,
    refreshStatus,
    requestJson,
    stopTalkback,
  ]);

  useEffect(() => {
    if (!config) {
      return;
    }

    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [config, refreshStatus]);

  useEffect(() => {
    return () => {
      stopVideo();
      stopAudioMonitor();
      void stopTalkback();
    };
  }, [stopAudioMonitor, stopTalkback, stopVideo]);

  return {
    videoRef,
    audioRef,
    serviceStatus,
    talkbackForwardActive,
    videoConnected,
    audioConnected,
    talkbackActive,
    loadingAction,
    error,
    refreshStatus,
    startVideo,
    stopVideo,
    startAudioMonitor,
    stopAudioMonitor,
    startTalkback,
    stopTalkback,
    stopAll,
  };
}
