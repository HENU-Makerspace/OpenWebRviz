import { useEffect, useMemo, useState } from 'react';
import { X, Volume2, Mic, ScanFace } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { FaceSnapshot } from '../hooks/useFaceRecognition';

interface MediaViewportProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoConnected: boolean;
  audioMonitoring: boolean;
  talkbackActive: boolean;
  faceSnapshot: FaceSnapshot;
  onCloseVideo: () => void;
}

export function MediaViewport({
  videoRef,
  videoConnected,
  audioMonitoring,
  talkbackActive,
  faceSnapshot,
  onCloseVideo,
}: MediaViewportProps) {
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0, sourceWidth: 0, sourceHeight: 0 });

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

  if (!videoConnected) {
    return null;
  }

  return (
    <div className="absolute right-4 top-4 z-20 w-[360px] max-w-[calc(100%-2rem)]">
      <Card className="overflow-hidden border-slate-300 shadow-xl">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-slate-950/95 text-white">
          <div className="space-y-1">
            <CardTitle className="text-sm text-white">Robot Camera</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="success">Live</Badge>
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
          <Button size="sm" variant="secondary" onClick={onCloseVideo}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="relative bg-black p-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            controls
            className="aspect-video w-full bg-black object-contain"
          />
          {overlayGeometry && faceSnapshot.faces.map((face) => {
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
        </CardContent>
      </Card>
    </div>
  );
}
