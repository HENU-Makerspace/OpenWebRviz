import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mic, Play, RefreshCw, ScanFace, VideoOff, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
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
    <div className="absolute bottom-4 left-4 z-20 w-[360px] max-w-[calc(100%-2rem)]">
      <Card className="overflow-hidden border-slate-700/70 bg-slate-950/95 text-white shadow-2xl shadow-black/30 backdrop-blur">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-white/10 px-3 py-2">
          <div className="space-y-1">
            <CardTitle className="text-sm text-white">Robot Camera</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={videoConnected ? 'success' : 'outline'}>
                {videoConnected ? 'Live' : 'Standby'}
              </Badge>
              {audioMonitoring && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-200">
                  <Volume2 className="h-3.5 w-3.5" />
                  Monitor
                </span>
              )}
              {talkbackActive && (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-200">
                  <Mic className="h-3.5 w-3.5" />
                  Talkback
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-200">
                <ScanFace className="h-3.5 w-3.5" />
                {faceSnapshot.online ? `${faceSnapshot.faces.length} face(s)` : 'Face offline'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-2">
          <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              controls={videoConnected}
              className={`aspect-video w-full bg-black object-contain ${videoConnected ? 'block' : 'opacity-0'}`}
            />
            {!videoConnected && (
              <div className="absolute inset-0 flex aspect-video flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black text-slate-500">
                <VideoOff className="mb-2 h-9 w-9" />
                <div className="text-xs uppercase tracking-[0.3em]">Video Standby</div>
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
              className="inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                  ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-200'
                  : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/20'
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
                  ? 'border-sky-400/50 bg-sky-400/20 text-sky-200'
                  : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/20'
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
                  ? 'border-amber-400/50 bg-amber-400/20 text-amber-200'
                  : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/20'
              }`}
            >
              {loadingAction === 'talkback' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-100">
              {error}
            </div>
          )}

          <audio ref={audioRef} autoPlay playsInline />
        </CardContent>
      </Card>
    </div>
  );
}
