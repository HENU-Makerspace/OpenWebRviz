import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRobotConfig } from '../packages/server/src/config';

const execFileAsync = promisify(execFile);

type FlatMap = Record<string, string>;

interface FaceHealth {
  online?: boolean;
  updatedAt?: string | null;
  identitiesLoaded?: number;
  lastError?: string | null;
}

interface MediaStatus {
  janus?: boolean;
  talkbackForward?: {
    active?: boolean;
    streamId?: number | null;
  };
  video?: {
    active?: boolean;
    activeState?: string;
    subState?: string;
    frameCount?: number;
    deviceExists?: boolean;
    lastFrameAt?: string | null;
  } | null;
}

const { config, profile: configProfile, configPath } = loadRobotConfig(`${process.cwd()}/packages/server/config`);
const CLOUD_HOST = String(config.server?.host || '182.43.86.126');
const JETSON_HOST = String(config.jetson?.host || '192.168.43.100');

const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const intervalArg = process.argv.find((arg) => arg.startsWith('--interval='));
const intervalMs = Math.max(1000, Number(intervalArg?.split('=')[1] || 3000));

function color(text: string, code: number) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function ok(value: boolean, label = 'ok') {
  return value ? color(label, 32) : color('fail', 31);
}

function statusChip(value: string) {
  if (value === 'active') return color(value, 32);
  if (value === 'inactive' || value === 'failed') return color(value, 31);
  if (!value) return color('unknown', 33);
  return color(value, 33);
}

function idleAware(active: boolean, activeLabel = 'active', idleLabel = 'idle') {
  return active ? color(activeLabel, 32) : color(idleLabel, 33);
}

async function runCommand(cmd: string, args: string[], timeout = 8000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch (error: any) {
    const stdout = error?.stdout?.toString?.() || '';
    const stderr = error?.stderr?.toString?.() || '';
    const detail = (stdout || stderr || error?.message || '').trim();
    throw new Error(detail || `Failed to run ${cmd}`);
  }
}

async function runSSH(target: string, script: string) {
  return runCommand('ssh', [target, script], 12000);
}

function isLocalHost(host: string) {
  return host === '127.0.0.1' || host === 'localhost';
}

async function runRemoteShell(host: string, userAtHost: string, script: string) {
  if (isLocalHost(host)) {
    return runCommand('bash', ['-lc', script], 12000);
  }
  return runSSH(userAtHost, script);
}

function parseKeyValue(text: string): FlatMap {
  const map: FlatMap = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    map[line.slice(0, index)] = line.slice(index + 1);
  }
  return map;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function ageMs(updatedAt?: string | null) {
  if (!updatedAt) return null;
  const value = Date.parse(updatedAt);
  if (Number.isNaN(value)) return null;
  return Date.now() - value;
}

function fmtAge(updatedAt?: string | null) {
  const age = ageMs(updatedAt);
  if (age == null) return 'n/a';
  if (age < 1000) return `${age}ms`;
  return `${(age / 1000).toFixed(1)}s`;
}

async function probeCloud() {
  const remote = await runRemoteShell(CLOUD_HOST, `root@${CLOUD_HOST}`, `
printf 'webbot_server=%s\n' "$(systemctl is-active webbot-server 2>/dev/null || true)"
printf 'nginx=%s\n' "$(systemctl is-active nginx 2>/dev/null || true)"
printf 'port_4001=%s\n' "$(ss -ltnp | grep -q ':4001 ' && echo yes || echo no)"
printf 'port_19090=%s\n' "$(ss -ltnp | grep -q ':19090 ' && echo yes || echo no)"
printf 'port_18088=%s\n' "$(ss -ltnp | grep -q ':18088 ' && echo yes || echo no)"
printf 'port_18000=%s\n' "$(ss -ltnp | grep -q ':18000 ' && echo yes || echo no)"
printf 'port_19100=%s\n' "$(ss -ltnp | grep -q ':19100 ' && echo yes || echo no)"
printf 'port_19110=%s\n' "$(ss -ltnp | grep -q ':19110 ' && echo yes || echo no)"
`);

  const metrics = parseKeyValue(remote);
  const apiHealth = await fetchJson<{ status?: string }>(`http://${CLOUD_HOST}/api/health`);
  const mediaStatus = await fetchJson<MediaStatus>(`http://${CLOUD_HOST}/api/media/status`);
  const faceHealth = await fetchJson<FaceHealth>(`http://${CLOUD_HOST}/api/face/health`);

  return { metrics, apiHealth, mediaStatus, faceHealth };
}

async function probeJetson() {
  const remote = await runRemoteShell(JETSON_HOST, `nvidia@${JETSON_HOST}`, `
printf 'media=%s\n' "$(systemctl --user is-active webbot-media.service 2>/dev/null || true)"
printf 'video=%s\n' "$(systemctl --user is-active webbot-video.service 2>/dev/null || true)"
printf 'control=%s\n' "$(systemctl --user is-active webbot-media-control.service 2>/dev/null || true)"
printf 'face=%s\n' "$(systemctl --user is-active webbot-face.service 2>/dev/null || true)"
printf 'tunnel=%s\n' "$(systemctl --user is-active webbot-reverse-tunnel.service 2>/dev/null || true)"
printf 'janus_proc=%s\n' "$(pgrep -f '/opt/janus/bin/janus' >/dev/null && echo yes || echo no)"
printf 'demo_proc=%s\n' "$(pgrep -f 'python3 -m http.server 8000' >/dev/null && echo yes || echo no)"
printf 'audio_capture_proc=%s\n' "$(pgrep -f 'gst-launch-1.0 -v alsasrc' >/dev/null && echo yes || echo no)"
printf 'audio_playback_proc=%s\n' "$(pgrep -f 'gst-launch-1.0 -v udpsrc port=5006' >/dev/null && echo yes || echo no)"
printf 'video_proc=%s\n' "$(pgrep -f 'gst-launch-1.0 v4l2src device=/dev/video0' >/dev/null && echo yes || echo no)"
printf 'port_9090=%s\n' "$(ss -ltnup | grep -q ':9090' && echo yes || echo no)"
printf 'port_8088=%s\n' "$(ss -ltnup | grep -q ':8088' && echo yes || echo no)"
printf 'port_8000=%s\n' "$(ss -ltnup | grep -q ':8000' && echo yes || echo no)"
printf 'port_19100=%s\n' "$(ss -ltnup | grep -q ':19100' && echo yes || echo no)"
printf 'port_19110=%s\n' "$(ss -ltnup | grep -q ':19110' && echo yes || echo no)"
printf 'port_5005=%s\n' "$(ss -ltnup | grep -q ':5005' && echo yes || echo no)"
printf 'port_5006=%s\n' "$(ss -ltnup | grep -q ':5006' && echo yes || echo no)"
printf 'audio_capture_dev=%s\n' "$(arecord -l 2>/dev/null | grep -q 'UACDemoV10' && echo yes || echo no)"
printf 'audio_playback_dev=%s\n' "$(aplay -l 2>/dev/null | grep -q 'UACDemoV10' && echo yes || echo no)"
printf 'frame_count=%s\n' "$(find ~/.local/state/webbot-media/frames -maxdepth 1 -name 'frame-*.jpg' 2>/dev/null | wc -l | tr -d ' ')"
printf 'video0_exists=%s\n' "$(test -e /dev/video0 && echo yes || echo no)"
curl -sS http://127.0.0.1:19100/health | sed 's/^/face_health_json=/'
`);

  const metrics = parseKeyValue(remote);
  const faceHealth = metrics.face_health_json ? JSON.parse(metrics.face_health_json) as FaceHealth : null;
  return { metrics, faceHealth };
}

function renderWarnings(cloud: Awaited<ReturnType<typeof probeCloud>>, jetson: Awaited<ReturnType<typeof probeJetson>>) {
  const warnings: string[] = [];
  if (jetson.metrics.audio_capture_proc !== 'yes') warnings.push('Jetson 音频采集链未运行，浏览器到机器人对讲发送会失败');
  if (jetson.metrics.audio_playback_proc !== 'yes') warnings.push('Jetson 音频回放链未运行，机器人扬声器不会出声');
  if (cloud.mediaStatus?.janus !== true) warnings.push('云服务器当前无法通过反向隧道访问 Janus');
  if (jetson.metrics.video === 'active' && jetson.metrics.frame_count === '0') warnings.push('Jetson 视频服务已启动，但当前没有新的视频 JPEG 帧');
  const faceAge = ageMs(jetson.faceHealth?.updatedAt);
  if (jetson.metrics.video === 'active' && faceAge != null && faceAge > 5000) warnings.push(`Jetson 人脸快照已 ${fmtAge(jetson.faceHealth?.updatedAt)} 未更新`);
  return warnings;
}

function section(title: string, lines: string[]) {
  return `${color(title, 36)}\n${lines.map((line) => `  ${line}`).join('\n')}`;
}

function render(cloud: Awaited<ReturnType<typeof probeCloud>>, jetson: Awaited<ReturnType<typeof probeJetson>>) {
  const warnings = renderWarnings(cloud, jetson);

  const output = [
    `${color('OpenWebRviz Ops Status', 1)}  ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `Profile: ${configProfile}${configPath ? `   Config: ${configPath}` : ''}`,
    `Cloud: ${CLOUD_HOST}   Jetson: ${JETSON_HOST}`,
    '',
    section('Cloud', [
      `systemd: webbot-server=${statusChip(cloud.metrics.webbot_server || '')} nginx=${statusChip(cloud.metrics.nginx || '')}`,
      `ports: 4001=${ok(cloud.metrics.port_4001 === 'yes')} 19090=${ok(cloud.metrics.port_19090 === 'yes')} 18088=${ok(cloud.metrics.port_18088 === 'yes')} 18000=${ok(cloud.metrics.port_18000 === 'yes')} 19100=${ok(cloud.metrics.port_19100 === 'yes')} 19110=${ok(cloud.metrics.port_19110 === 'yes')}`,
      `api: /health=${ok(cloud.apiHealth?.status === 'ok')} janus=${ok(cloud.mediaStatus?.janus === true)} video=${idleAware(cloud.mediaStatus?.video?.active === true)} talkbackForward=${idleAware(cloud.mediaStatus?.talkbackForward?.active === true, 'active', 'idle')} faceOnline=${cloud.mediaStatus?.video?.active ? ok(cloud.faceHealth?.online === true) : color('idle', 33)}`,
      `face: identities=${cloud.faceHealth?.identitiesLoaded ?? 'n/a'} age=${fmtAge(cloud.faceHealth?.updatedAt)} error=${cloud.faceHealth?.lastError || '-'}`,
    ]),
    '',
    section('Jetson', [
      `systemd: media=${statusChip(jetson.metrics.media || '')} video=${statusChip(jetson.metrics.video || '')} control=${statusChip(jetson.metrics.control || '')} face=${statusChip(jetson.metrics.face || '')} tunnel=${statusChip(jetson.metrics.tunnel || '')}`,
      `procs: janus=${ok(jetson.metrics.janus_proc === 'yes')} demo=${ok(jetson.metrics.demo_proc === 'yes')} audio-capture=${ok(jetson.metrics.audio_capture_proc === 'yes')} audio-playback=${ok(jetson.metrics.audio_playback_proc === 'yes')} video=${idleAware(jetson.metrics.video === 'active')}`,
      `ports: 9090=${ok(jetson.metrics.port_9090 === 'yes')} 8088=${ok(jetson.metrics.port_8088 === 'yes')} 8000=${ok(jetson.metrics.port_8000 === 'yes')} 19100=${ok(jetson.metrics.port_19100 === 'yes')} 19110=${ok(jetson.metrics.port_19110 === 'yes')} 5005=${ok(jetson.metrics.port_5005 === 'yes')} 5006=${ok(jetson.metrics.port_5006 === 'yes')}`,
      `devices: mic=${ok(jetson.metrics.audio_capture_dev === 'yes')} spk=${ok(jetson.metrics.audio_playback_dev === 'yes')} video0=${ok(jetson.metrics.video0_exists === 'yes')} frames=${jetson.metrics.frame_count ?? '0'}`,
      `face: online=${jetson.metrics.video === 'active' ? ok(jetson.faceHealth?.online === true) : color('idle', 33)} identities=${jetson.faceHealth?.identitiesLoaded ?? 'n/a'} age=${fmtAge(jetson.faceHealth?.updatedAt)} error=${jetson.faceHealth?.lastError || '-'}`,
    ]),
    '',
    section('Warnings', warnings.length > 0 ? warnings : [color('No obvious warnings', 32)]),
    '',
    'Hints:',
    '  q / Ctrl+C 退出',
    '  bun run ops:status -- --once    单次快照',
  ];

  return output.join('\n');
}

async function tick() {
  const [cloud, jetson] = await Promise.all([probeCloud(), probeJetson()]);
  const text = render(cloud, jetson);
  if (!once) {
    process.stdout.write('\u001b[2J\u001b[H');
  }
  process.stdout.write(`${text}\n`);
}

async function main() {
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('data', (buffer) => {
    const value = buffer.toString();
    if (value === 'q' || buffer[0] === 3) {
      process.exit(0);
    }
  });

  if (once) {
    await tick();
    process.exit(0);
  }

  while (true) {
    try {
      await tick();
    } catch (error) {
      process.stdout.write('\u001b[2J\u001b[H');
      process.stdout.write(`${color('Probe failed', 31)} ${String(error)}\n`);
    }
    await Bun.sleep(intervalMs);
  }
}

await main();
