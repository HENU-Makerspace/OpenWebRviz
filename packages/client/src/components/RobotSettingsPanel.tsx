import { useEffect, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';

export interface RobotSettings {
  profile: string;
  configPath: string | null;
  jetson: {
    host: string;
    rosbridgePort: number;
  };
  media: {
    videoDevice: string;
    videoWidth: number;
    videoHeight: number;
    videoBitrate: number;
    controlProxyPort: number;
    janusHttpPort: number;
    janusDemoPort: number;
    audioCaptureDevice: string;
    audioPlaybackDevice: string;
    serviceName: string;
    videoServiceName: string;
    controlServiceName: string;
  };
  face: {
    videoDevice: string;
    frameWidth: number;
    frameHeight: number;
    proxyPort: number;
    intervalMs: number;
    scoreThreshold: number;
    serviceName: string;
  };
  reverseTunnel: {
    serverHost: string;
    rosbridgePort: number;
    mediaControlPort: number;
    facePort: number;
  };
  generated: {
    mediaControlExecStart: string;
    faceExecStart: string;
  };
}

interface RobotSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

function numberValue(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildMediaExecStart(settings: RobotSettings) {
  return [
    '/usr/bin/python3',
    '%h/bin/webbot-media-control.py',
    '--host', '127.0.0.1',
    '--port', String(settings.media.controlProxyPort),
    '--video-service', settings.media.videoServiceName,
    '--media-service', settings.media.serviceName,
    '--frame-dir', '%h/.local/state/webbot-media/frames',
    '--video-device', settings.media.videoDevice,
    '--start-timeout-ms', '12000',
  ].join(' ');
}

function buildFaceExecStart(settings: RobotSettings) {
  return [
    '%h/face/.venv/bin/python',
    '%h/bin/webbot-face-service.py',
    '--host', '127.0.0.1',
    '--port', String(settings.face.proxyPort),
    '--frame-dir', '%h/.local/state/webbot-media/frames',
    '--device', settings.face.videoDevice,
    '--width', String(settings.face.frameWidth),
    '--height', String(settings.face.frameHeight),
    '--interval-ms', String(settings.face.intervalMs),
    '--frame-stale-ms', '1500',
    '--similarity-threshold', String(settings.face.scoreThreshold),
    '--model-root', '%h/face/insightface',
    '--face-db-dir', '%h/face/face_db',
    '--registry-path', '%h/face/registry.json',
  ].join(' ');
}

export function RobotSettingsPanel({ open, onClose }: RobotSettingsPanelProps) {
  const [settings, setSettings] = useState<RobotSettings | null>(null);
  const [draft, setDraft] = useState<RobotSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLoading(true);
    setError(null);
    setSavedMessage(null);

    fetch('/api/settings')
      .then((res) => res.json())
      .then((data: RobotSettings) => {
        setSettings(data);
        setDraft(data);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) {
    return null;
  }

  const updateDraft = (updater: (current: RobotSettings) => RobotSettings) => {
    setDraft((current) => {
      if (!current) return current;
      const next = updater(current);
      return {
        ...next,
        generated: {
          mediaControlExecStart: buildMediaExecStart(next),
          faceExecStart: buildFaceExecStart(next),
        },
      };
    });
  };

  const handleSave = async () => {
    if (!draft) return;

    setSaving(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.details || result?.error || `HTTP ${response.status}`);
      }

      setSettings(result.settings);
      setDraft(result.settings);
      setSavedMessage('已保存到当前 profile 配置文件');
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApplyToJetson = async () => {
    setApplying(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await fetch('/api/settings/apply-jetson', {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.details || result?.error || `HTTP ${response.status}`);
      }

      setSavedMessage(`已应用到 ${result.target}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/30">
      <div className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-slate-100 p-2 text-slate-700">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">设备与服务设置</div>
              <div className="text-xs text-slate-500">
                {settings?.profile || 'unknown'} {settings?.configPath ? `· ${settings.configPath}` : ''}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            关闭
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading || !draft ? (
            <div className="text-sm text-slate-500">正在加载设置...</div>
          ) : (
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Jetson</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Jetson Host</div>
                    <input
                      value={draft.jetson.host}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        jetson: { ...current.jetson, host: e.target.value },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Rosbridge Port</div>
                    <input
                      value={draft.jetson.rosbridgePort}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        jetson: { ...current.jetson, rosbridgePort: numberValue(e.target.value, current.jetson.rosbridgePort) },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">视频与媒体</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Video Device</div>
                    <input
                      value={draft.media.videoDevice}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        media: { ...current.media, videoDevice: e.target.value },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Face Device</div>
                    <input
                      value={draft.face.videoDevice}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        face: { ...current.face, videoDevice: e.target.value },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Audio Capture</div>
                    <input
                      value={draft.media.audioCaptureDevice}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        media: { ...current.media, audioCaptureDevice: e.target.value },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Audio Playback</div>
                    <input
                      value={draft.media.audioPlaybackDevice}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        media: { ...current.media, audioPlaybackDevice: e.target.value },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">端口</div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Media Ctrl</div>
                    <input
                      value={draft.media.controlProxyPort}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        media: { ...current.media, controlProxyPort: numberValue(e.target.value, current.media.controlProxyPort) },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Face Proxy</div>
                    <input
                      value={draft.face.proxyPort}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        face: { ...current.face, proxyPort: numberValue(e.target.value, current.face.proxyPort) },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-slate-600">
                    <div>Rosbridge Tunnel</div>
                    <input
                      value={draft.reverseTunnel.rosbridgePort}
                      onChange={(e) => updateDraft((current) => ({
                        ...current,
                        reverseTunnel: { ...current.reverseTunnel, rosbridgePort: numberValue(e.target.value, current.reverseTunnel.rosbridgePort) },
                      }))}
                      className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">生成的 Service 命令</div>
                <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Media Control ExecStart</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-800">{draft.generated.mediaControlExecStart}</pre>
                </div>
                <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Face Service ExecStart</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-800">{draft.generated.faceExecStart}</pre>
                </div>
              </section>

              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {error}
                </div>
              )}
              {savedMessage && (
                <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                  {savedMessage}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-4">
          <div className="text-xs text-slate-500">
            先保存配置，再应用到 Jetson，会重载并重启相关媒体/人脸服务。
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleApplyToJetson()}
              disabled={loading || saving || applying || !draft}
              className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {applying ? '应用中...' : '应用到 Jetson'}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={loading || saving || applying || !draft}
              className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
