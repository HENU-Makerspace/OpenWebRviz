import { X, Volume2, Mic } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

interface MediaViewportProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoConnected: boolean;
  audioMonitoring: boolean;
  talkbackActive: boolean;
  onCloseVideo: () => void;
}

export function MediaViewport({
  videoRef,
  videoConnected,
  audioMonitoring,
  talkbackActive,
  onCloseVideo,
}: MediaViewportProps) {
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
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onCloseVideo}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="bg-black p-0">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            controls
            className="aspect-video w-full bg-black object-contain"
          />
        </CardContent>
      </Card>
    </div>
  );
}
