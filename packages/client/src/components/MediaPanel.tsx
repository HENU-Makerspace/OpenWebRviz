import { Loader2, Mic, Play, RefreshCw, Square, Volume2, Waves } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useRobotMedia } from '../hooks/useRobotMedia';

interface MediaPanelProps {
  media: ReturnType<typeof useRobotMedia>;
}

function StatusBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <Badge variant={active ? 'success' : 'outline'}>
      {label}
    </Badge>
  );
}

export function MediaPanel({ media }: MediaPanelProps) {
  const busy = media.loadingAction !== null;
  const canStop = media.videoConnected || media.audioConnected || media.talkbackActive || media.talkbackForwardActive;

  return (
    <Card className="border-slate-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-slate-600" />
          Media Console
        </CardTitle>
        <CardDescription>
          连接云端 Janus 媒体链路。Jetson 采集进程需要在设备侧自行运行。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge label="Janus" active={media.serviceStatus.janus} />
          <StatusBadge label="RTP Forward" active={media.talkbackForwardActive} />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <Button
            onClick={() => void media.stopAll()}
            disabled={busy || !canStop}
            variant="destructive"
            size="sm"
          >
            {media.loadingAction === 'stop-all' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            断开媒体
          </Button>
        </div>

        <Button onClick={media.refreshStatus} disabled={busy} variant="secondary" size="sm" className="w-full">
          <RefreshCw className="h-4 w-4" />
          刷新状态
        </Button>

        <div className="grid grid-cols-1 gap-2">
          <Button
            onClick={media.videoConnected ? media.stopVideo : () => void media.startVideo()}
            disabled={busy}
            variant={media.videoConnected ? 'secondary' : 'outline'}
            size="sm"
          >
            <Play className="h-4 w-4" />
            {media.videoConnected ? '关闭视频' : '打开视频'}
          </Button>

          <Button
            onClick={media.audioConnected ? media.stopAudioMonitor : () => void media.startAudioMonitor()}
            disabled={busy}
            variant={media.audioConnected ? 'secondary' : 'outline'}
            size="sm"
          >
            <Volume2 className="h-4 w-4" />
            {media.audioConnected ? '停止监听' : '监听机器人声音'}
          </Button>

          <Button
            onClick={media.talkbackActive ? () => void media.stopTalkback() : () => void media.startTalkback()}
            disabled={busy}
            variant={media.talkbackActive ? 'secondary' : 'outline'}
            size="sm"
          >
            <Mic className="h-4 w-4" />
            {media.talkbackActive ? '结束对讲' : '开始对讲'}
          </Button>
        </div>

        {media.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {media.error}
          </div>
        )}

        <audio ref={media.audioRef} autoPlay playsInline />
      </CardContent>
    </Card>
  );
}
