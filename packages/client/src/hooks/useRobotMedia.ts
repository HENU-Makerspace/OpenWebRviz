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
  video: VideoServiceStatus | null;
}

interface MediaStatusResponse {
  janus: boolean;
  talkbackForward: {
    active: boolean;
    streamId: number | null;
  };
  video: VideoServiceStatus | null;
}

interface VideoServiceStatus {
  service?: string;
  active: boolean;
  activeState?: string;
  subState?: string;
  result?: string;
  frameCount?: number;
  lastFrameAt?: string | null;
  deviceExists?: boolean;
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

type LegacyNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    failure: (error: unknown) => void,
  ) => void;
  webkitGetUserMedia?: LegacyNavigator['getUserMedia'];
  mozGetUserMedia?: LegacyNavigator['getUserMedia'];
  msGetUserMedia?: LegacyNavigator['getUserMedia'];
};

const scriptCache = new Map<string, Promise<void>>();
let janusInitPromise: Promise<void> | null = null;
const ADAPTER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/webrtc-adapter/9.0.3/adapter.min.js';

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!raw.trim()) {
    return {} as T;
  }

  if (!isJson) {
    const snippet = raw.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(`Unexpected non-JSON response (${response.status}): ${snippet || 'empty response'}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const snippet = raw.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(`Invalid JSON response (${response.status}): ${snippet || String(error)}`);
  }
}

function isMissingJanusSession(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('458') || message.includes('No such session');
}

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

async function requestMicrophoneStream() {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  const legacyNavigator = navigator as LegacyNavigator;
  const legacyGetUserMedia =
    legacyNavigator.getUserMedia ||
    legacyNavigator.webkitGetUserMedia ||
    legacyNavigator.mozGetUserMedia ||
    legacyNavigator.msGetUserMedia;

  if (legacyGetUserMedia) {
    return new Promise<MediaStream>((resolve, reject) => {
      legacyGetUserMedia.call(legacyNavigator, { audio: true }, resolve, reject);
    });
  }

  const protocolHint = window.isSecureContext
    ? '当前浏览器没有暴露可用的麦克风采集接口'
    : '当前页面不是安全上下文，浏览器不会开放麦克风接口';

  throw new Error(`${protocolHint}。请使用 HTTPS 或 localhost 打开前端后再试。当前地址：${window.location.origin}`);
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
    video: null,
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
  const janusCreatePromiseRef = useRef<Promise<any> | null>(null);
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

    const janus = janusRef.current;
    janusRef.current = null;
    janusCreatePromiseRef.current = null;

    janus.destroy({
      cleanupHandles: true,
      success: () => undefined,
      error: () => undefined,
    });
  }, []);

  const requestJson = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const data = await readJsonResponse<T>(response);

    if (!response.ok) {
      const payload = data as Record<string, unknown> | null;
      throw new Error(
        String(payload?.details || payload?.error || `Request failed: ${response.status}`),
      );
    }

    return data as T;
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!config) {
      return null;
    }

    try {
      const response = await requestJson<MediaStatusResponse>('/api/media/status');
      setServiceStatus({
        janus: response.janus,
        video: response.video || null,
      });
      setTalkbackForwardActive(response.talkbackForward.active);
      return response;
    } catch (err) {
      setServiceStatus({
        janus: false,
        video: null,
      });
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

    if (!janusCreatePromiseRef.current) {
      janusCreatePromiseRef.current = new Promise<any>((resolve, reject) => {
        const janus = new window.Janus({
          server: config.janusApiUrl,
          success: () => {
            janusRef.current = janus;
            janusCreatePromiseRef.current = null;
            resolve(janus);
          },
          error: (err: unknown) => {
            janusRef.current = null;
            janusCreatePromiseRef.current = null;
            reject(err);
          },
          destroyed: () => {
            janusRef.current = null;
            janusCreatePromiseRef.current = null;
          },
        });
      });
    }

    return janusCreatePromiseRef.current;
  }, [config]);

  const attachPlugin = useCallback(async (plugin: string, options: Record<string, unknown>) => {
    const attachOnce = async () => {
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
    };

    try {
      return await attachOnce();
    } catch (error) {
      if (!isMissingJanusSession(error)) {
        throw error;
      }

      janusRef.current = null;
      janusCreatePromiseRef.current = null;
      return attachOnce();
    }
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

  const disconnectVideoStream = useCallback(() => {
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

  const stopVideo = useCallback(async () => {
    disconnectVideoStream();

    if (config) {
      try {
        await requestJson('/api/media/video/stop', { method: 'POST' });
      } catch {
        // The browser should still finish local cleanup even if the remote stop fails.
      }
    }

    await refreshStatus();
  }, [config, disconnectVideoStream, refreshStatus, requestJson]);

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
    await stopVideo();
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
      disconnectVideoStream();
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
              kind === 'video'
                ? { type: 'video', recv: true }
                : { type: 'audio', recv: true },
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
    disconnectVideoStream,
    pluginMessage,
    refreshStatus,
    stopAudioMonitor,
  ]);

  const startVideo = useCallback(async () => {
    setLoadingAction('video');
    setError(null);
    try {
      if (!serviceStatus.video?.active) {
        await requestJson('/api/media/video/start', { method: 'POST' });
      }
      await refreshStatus();
      await connectStreaming('video');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await stopVideo();
    } finally {
      setLoadingAction(null);
    }
  }, [connectStreaming, refreshStatus, requestJson, serviceStatus.video?.active, stopVideo]);

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
      const microphoneStream = await requestMicrophoneStream();
      const microphoneTrack = microphoneStream.getAudioTracks()[0];

      if (!microphoneTrack) {
        stopTracks(microphoneStream);
        throw new Error('浏览器没有返回可用的麦克风音轨，请检查麦克风权限和输入设备。');
      }

      localTalkbackStreamRef.current = microphoneStream;
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
                { type: 'audio', capture: microphoneTrack, recv: true },
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
    stopTracks,
    stopTalkback,
  ]);

  useEffect(() => {
    if (!config) {
      return;
    }

    void (async () => {
      const status = await refreshStatus();

      if (status?.video?.active) {
        disconnectVideoStream();
        try {
          await requestJson('/api/media/video/stop', { method: 'POST' });
        } catch {
          // Ignore initial cleanup failure and let manual controls handle it.
        }
        await refreshStatus();
      }
    })();

    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [config, disconnectVideoStream, refreshStatus, requestJson]);

  useEffect(() => {
    return () => {
      void stopVideo();
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
