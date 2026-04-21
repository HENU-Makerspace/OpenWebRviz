import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mic, Play, RefreshCw, VideoOff, Volume2 } from 'lucide-react';
import type { FaceSnapshot } from '../hooks/useFaceRecognition';

interface MediaViewportProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  audioRef: React.RefObject<HTMLAudioElement>;
  videoConnected: boolean;
  audioMonitoring: boolean;
  talkbackActive: boolean;
  loadingAction: string | null;
  error: string | null;
  faceSnapshot: FaceSnapshot;
  onRefresh: () => void;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onToggleTalkback: () => void;
}

export function MediaViewport({
  videoRef,
  audioRef,
  videoConnected,
  audioMonitoring,
  talkbackActive,
  loadingAction,
  error,
  faceSnapshot,
  onRefresh,
  onToggleVideo,
  onToggleAudio,
  onToggleTalkback,
}: MediaViewportProps) {
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0, sourceWidth: 0, sourceHeight: 0 });
  const busy = loadingAction !== null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const updateMetrics = () => {
      setVideoSize({
        width: video.clientWidth,
        height: video.clientHeight,
        sourceWidth: video.videoWidth || faceSnapshot.frameWidth || 0,
        sourceHeight: video.videoHeight || faceSnapshot.frameHeight || 0,
      });
    };

    updateMetrics();
    video.addEventListener('loadedmetadata', updateMetrics);
    window.addEventListener('resize', updateMetrics);
    const timer = window.setInterval(updateMetrics, 500);

    return () => {
      video.removeEventListener('loadedmetadata', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      window.clearInterval(timer);
    };
  }, [faceSnapshot.frameHeight, faceSnapshot.frameWidth, videoRef]);

  const overlayGeometry = useMemo(() => {
    const sourceWidth = videoSize.sourceWidth || faceSnapshot.frameWidth;
    const sourceHeight = videoSize.sourceHeight || faceSnapshot.frameHeight;
    if (!videoSize.width || !videoSize.height || !sourceWidth || !sourceHeight) {
      return null;
    }

    const scale = Math.min(videoSize.width / sourceWidth, videoSize.height / sourceHeight);
    const renderedWidth = sourceWidth * scale;
    const renderedHeight = sourceHeight * scale;

    return {
      scale,
      offsetX: (videoSize.width - renderedWidth) / 2,
      offsetY: (videoSize.height - renderedHeight) / 2,
    };
  }, [faceSnapshot.frameHeight, faceSnapshot.frameWidth, videoSize]);

  return (
    <div className="w-full space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black shadow-sm">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          controls={videoConnected}
          className={`aspect-video w-full bg-black object-contain ${videoConnected ? 'block' : 'opacity-0'}`}
        />
        {!videoConnected && (
          <div className="absolute inset-0 flex aspect-video items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-black text-slate-500">
            <VideoOff className="h-9 w-9" />
          </div>
        )}
        {videoConnected && overlayGeometry && faceSnapshot.faces.map((face) => {
          const left = overlayGeometry.offsetX + face.bbox.x * overlayGeometry.scale;
          const top = overlayGeometry.offsetY + face.bbox.y * overlayGeometry.scale;
          const width = face.bbox.w * overlayGeometry.scale;
          const height = face.bbox.h * overlayGeometry.scale;

          return (
            <div
              key={face.id}
              className="pointer-events-none absolute border-2 border-emerald-400"
              style={{
                left,
                top,
                width,
                height,
              }}
            >
              <div className="absolute left-0 top-0 -translate-y-full rounded bg-emerald-500/90 px-2 py-0.5 text-[11px] font-medium text-white shadow">
                {face.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          title="刷新"
          aria-label="刷新媒体状态"
          onClick={onRefresh}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingAction === 'status' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title={videoConnected ? '关闭视频' : '打开视频'}
          aria-label={videoConnected ? '关闭视频' : '打开视频'}
          onClick={onToggleVideo}
          disabled={busy}
          className={`inline-flex h-10 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50 ${
            videoConnected
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {loadingAction === 'video' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title={audioMonitoring ? '停止监听' : '监听'}
          aria-label={audioMonitoring ? '停止监听' : '监听'}
          onClick={onToggleAudio}
          disabled={busy}
          className={`inline-flex h-10 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50 ${
            audioMonitoring
              ? 'border-sky-300 bg-sky-50 text-sky-700'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {loadingAction === 'audio' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title={talkbackActive ? '结束对讲' : '对讲'}
          aria-label={talkbackActive ? '结束对讲' : '对讲'}
          onClick={onToggleTalkback}
          disabled={busy}
          className={`inline-flex h-10 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50 ${
            talkbackActive
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {loadingAction === 'talkback' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-600">
          {error}
        </div>
      )}

      <audio ref={audioRef} autoPlay playsInline />
    </div>
  );
}
