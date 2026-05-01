import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'path';
import { loadRobotConfig, mergeYamlConfig, saveYamlConfig, type YamlConfig, type YamlPrimitive } from './config';

const execAsync = promisify(exec);
const app = new Hono();

const MAPS_DIR = path.join(process.cwd(), 'maps');

const { config, configPath, profile: configProfile } = loadRobotConfig(path.join(process.cwd(), 'config'));

function loadCurrentRobotConfig() {
  return loadRobotConfig(path.join(process.cwd(), 'config'), configProfile);
}

function asString(value: YamlPrimitive | undefined, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
}

function asNumber(value: YamlPrimitive | undefined, fallback = 0) {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderMediaControlExecStart(sourceConfig: YamlConfig) {
  const media = sourceConfig.media || {};
  return [
    '/usr/bin/python3',
    '%h/bin/webbot-media-control.py',
    '--host', '127.0.0.1',
    '--port', String(asNumber(media.control_proxy_port, 19110)),
    '--video-service', asString(media.video_service_name, 'webbot-video.service'),
    '--media-service', asString(media.service_name, 'webbot-media.service'),
    '--frame-dir', '%h/.local/state/webbot-media/frames',
    '--video-device', asString(media.video_device, '/dev/video0'),
    '--start-timeout-ms', '12000',
  ].join(' ');
}

function renderFaceExecStart(sourceConfig: YamlConfig) {
  const face = sourceConfig.face || {};
  return [
    '%h/face/.venv/bin/python',
    '%h/bin/webbot-face-service.py',
    '--host', '127.0.0.1',
    '--port', String(asNumber(face.proxy_port, 19100)),
    '--frame-dir', '%h/.local/state/webbot-media/frames',
    '--device', asString(face.video_device, '/dev/video0'),
    '--width', String(asNumber(face.frame_width, 1280)),
    '--height', String(asNumber(face.frame_height, 720)),
    '--interval-ms', String(asNumber(face.inference_interval_ms, 150)),
    '--frame-stale-ms', '1500',
    '--similarity-threshold', String(asNumber(face.score_threshold, 0.35)),
    '--model-root', '%h/face/insightface',
    '--face-db-dir', '%h/face/face_db',
    '--registry-path', '%h/face/registry.json',
  ].join(' ');
}

function buildSettingsPayload(sourceConfig: YamlConfig) {
  const jetson = sourceConfig.jetson || {};
  const media = sourceConfig.media || {};
  const face = sourceConfig.face || {};
  const reverseTunnel = sourceConfig.reverse_tunnel || {};

  return {
    profile: configProfile,
    configPath,
    jetson: {
      host: asString(jetson.host, ''),
      rosbridgePort: asNumber(jetson.rosbridge_port, 9090),
    },
    media: {
      videoDevice: asString(media.video_device, '/dev/video0'),
      videoWidth: asNumber(media.video_width, 1280),
      videoHeight: asNumber(media.video_height, 720),
      videoBitrate: asNumber(media.video_bitrate, 4000),
      controlProxyPort: asNumber(media.control_proxy_port, 19110),
      janusHttpPort: asNumber(media.janus_http_port, 8088),
      janusDemoPort: asNumber(media.janus_demo_port, 8000),
      audioCaptureDevice: asString(media.audio_capture_device, ''),
      audioPlaybackDevice: asString(media.audio_playback_device, ''),
      serviceName: asString(media.service_name, 'webbot-media.service'),
      videoServiceName: asString(media.video_service_name, 'webbot-video.service'),
      controlServiceName: asString(media.control_service_name, 'webbot-media-control.service'),
    },
    face: {
      videoDevice: asString(face.video_device, '/dev/video0'),
      frameWidth: asNumber(face.frame_width, 1280),
      frameHeight: asNumber(face.frame_height, 720),
      proxyPort: asNumber(face.proxy_port, 19100),
      intervalMs: asNumber(face.inference_interval_ms, 150),
      scoreThreshold: asNumber(face.score_threshold, 0.35),
      serviceName: asString(face.service_name, 'webbot-face.service'),
    },
    reverseTunnel: {
      serverHost: asString(reverseTunnel.server_host, ''),
      rosbridgePort: asNumber(reverseTunnel.rosbridge_port, 19090),
      mediaControlPort: asNumber(reverseTunnel.media_control_port, 19110),
      facePort: asNumber(reverseTunnel.face_port, 19100),
    },
    generated: {
      mediaControlExecStart: renderMediaControlExecStart(sourceConfig),
      faceExecStart: renderFaceExecStart(sourceConfig),
    },
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderMediaControlUnit(sourceConfig: YamlConfig) {
  return `[Unit]
Description=WebBot Local Media Control API
After=webbot-media.service
Requires=webbot-media.service

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=${renderMediaControlExecStart(sourceConfig)}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

function renderFaceUnit(sourceConfig: YamlConfig) {
  return `[Unit]
Description=WebBot Face Recognition Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=${renderFaceExecStart(sourceConfig)}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

function renderMediaUnit() {
  return fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-media.service'), 'utf-8');
}

function renderVideoUnit() {
  return fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-video.service'), 'utf-8');
}

function renderMediaEnv(sourceConfig: YamlConfig) {
  const media = sourceConfig.media || {};
  return `JANUS_BINARY=${shellQuote(asString(media.janus_binary, '/opt/janus/bin/janus'))}
JANUS_HTML_DIR=${shellQuote(asString(media.janus_html_dir, '/opt/janus/share/janus/html'))}
JANUS_DEMO_PORT=${shellQuote(String(asNumber(media.janus_demo_port, 8000)))}
AUDIO_CAPTURE_DEVICE=${shellQuote(asString(media.audio_capture_device, 'plughw:CARD=UACDemoV10,DEV=0'))}
AUDIO_CAPTURE_PORT=${shellQuote(String(asNumber(media.audio_capture_port, 5005)))}
AUDIO_PLAYBACK_DEVICE=${shellQuote(asString(media.audio_playback_device, 'plughw:CARD=UACDemoV10,DEV=0'))}
AUDIO_PLAYBACK_PORT=${shellQuote(String(asNumber(media.audio_playback_port, 5006)))}
VIDEO_DEVICE=${shellQuote(asString(media.video_device, '/dev/video0'))}
VIDEO_PORT=${shellQuote(String(asNumber(media.video_port, 8004)))}
VIDEO_WIDTH=${shellQuote(String(asNumber(media.video_width, 1280)))}
VIDEO_HEIGHT=${shellQuote(String(asNumber(media.video_height, 720)))}
VIDEO_FRAMERATE=${shellQuote(asString(media.video_framerate, '30/1'))}
VIDEO_BITRATE=${shellQuote(String(asNumber(media.video_bitrate, 4000)))}
`;
}

function renderVideoEnv(sourceConfig: YamlConfig) {
  const media = sourceConfig.media || {};
  return `VIDEO_DEVICE=${shellQuote(asString(media.video_device, '/dev/video0'))}
VIDEO_PORT=${shellQuote(String(asNumber(media.video_port, 8004)))}
VIDEO_WIDTH=${shellQuote(String(asNumber(media.video_width, 1280)))}
VIDEO_HEIGHT=${shellQuote(String(asNumber(media.video_height, 720)))}
VIDEO_FRAMERATE=${shellQuote(asString(media.video_framerate, '30/1'))}
VIDEO_BITRATE=${shellQuote(String(asNumber(media.video_bitrate, 4000)))}
`;
}

async function writeRemoteFiles(host: string, files: Array<{ remotePath: string; content: string }>) {
  if (files.length === 0) {
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webbot-remote-batch-'));

  try {
    const parentDirs = Array.from(new Set(files.map(({ remotePath }) => path.posix.dirname(remotePath))));
    await execAsync(`ssh ${host} mkdir -p ${parentDirs.map(shellQuote).join(' ')}`);

    for (const { remotePath, content } of files) {
      const localPath = path.join(tempDir, path.basename(remotePath));
      fs.writeFileSync(localPath, content, 'utf-8');
      await execAsync(`scp ${shellQuote(localPath)} ${host}:${shellQuote(remotePath)}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Server configuration
const SERVER_HOST = config?.server?.host || process.env.SERVER_HOST || '192.168.1.100';
const SERVER_PORT = config?.server?.port || process.env.SERVER_PORT || 4001;

// Jetson configuration
const JETSON_HOST = config?.jetson?.host || process.env.JETSON_HOST || '192.168.43.100';
const JETSON_ROSBRIDGE_PORT = config?.jetson?.rosbridge_port || 9090;
const JANUS_HOST = config?.media?.janus_host || JETSON_HOST;
const JANUS_HTTP_PORT = config?.media?.janus_http_port || 8088;
const JANUS_API_PATH = config?.media?.janus_api_path || '/janus';
const JANUS_DEMO_PORT = config?.media?.janus_demo_port || 8000;
const JANUS_STREAMING_PATH = config?.media?.streaming_path || '/demos/streaming.html#';
const JANUS_AUDIOBRIDGE_PATH = config?.media?.audiobridge_path || '/demos/audiobridge.html';
const JANUS_ADAPTER_ASSET = config?.media?.adapter_asset || 'adapter.min.js';
const JANUS_SCRIPT_ASSET = config?.media?.janus_script_asset || 'janus.js';
const LOCAL_JANUS_GATEWAY_DIR = asString(config?.media?.local_janus_gateway_dir, path.join(process.cwd(), '..', '..', 'janus-gateway'));
const LOCAL_JANUS_DEMOS_DIR = path.join(LOCAL_JANUS_GATEWAY_DIR, 'html', 'demos');
const MEDIA_AUDIO_PLAYBACK_PORT = config?.media?.audio_playback_port || 5006;
const MEDIA_VIDEO_STREAM_ID = config?.media?.preferred_video_stream_id || 0;
const MEDIA_AUDIO_STREAM_ID = config?.media?.preferred_audio_stream_id || 0;
const MEDIA_AUDIO_BRIDGE_ROOM = config?.media?.audiobridge_room || 1234;
const MEDIA_AUDIO_BRIDGE_SECRET = config?.media?.audiobridge_secret || 'adminpwd';
const MEDIA_AUDIO_BRIDGE_FORWARD_HOST = config?.media?.audiobridge_forward_host || '127.0.0.1';
const MEDIA_AUDIO_BRIDGE_FORWARD_PORT = config?.media?.audiobridge_forward_port || MEDIA_AUDIO_PLAYBACK_PORT;
const MEDIA_AUDIO_BRIDGE_DISPLAY = config?.media?.audiobridge_display || 'webbot-ui';
const MEDIA_CONTROL_PROXY_HOST = config?.media?.control_proxy_host || '127.0.0.1';
const MEDIA_CONTROL_PROXY_PORT = config?.media?.control_proxy_port || 19110;
const FRONTEND_WS_URL = process.env.FRONTEND_WS_URL || config?.frontend?.ws_url || '';
const FACE_PROXY_HOST = config?.face?.proxy_host || '127.0.0.1';
const FACE_PROXY_PORT = config?.face?.proxy_port || 19100;
const FACE_API_PATH = config?.face?.api_path || '/faces/latest';
const FACE_HEALTH_PATH = config?.face?.health_path || '/health';
const FACE_POLL_INTERVAL_MS = config?.face?.poll_interval_ms || 500;

console.log('[Config] Loaded config:', {
  configProfile,
  configPath,
  SERVER_HOST,
  JETSON_HOST,
  JETSON_ROSBRIDGE_PORT,
  JANUS_HOST,
  JANUS_HTTP_PORT,
  JANUS_API_PATH,
  JANUS_DEMO_PORT,
  MEDIA_CONTROL_PROXY_PORT,
  FACE_PROXY_PORT,
});

function randomTransaction() {
  return Math.random().toString(36).slice(2, 12);
}

async function fetchWithTimeout(targetUrl: string, init?: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(targetUrl, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonPayload<T>(payload: string, response: Response): T {
  if (!payload.trim()) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const snippet = payload.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`Unexpected upstream content-type ${contentType || 'unknown'}: ${snippet}`);
  }

  return JSON.parse(payload) as T;
}

async function forwardJanusRequest<T = any>(plugin: string, body: Record<string, unknown>) {
  const baseUrl = `http://${JANUS_HOST}:${JANUS_HTTP_PORT}${JANUS_API_PATH}`;

  const createRes = await fetchWithTimeout(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ janus: 'create', transaction: randomTransaction() }),
  }, 5000);
  const createText = await createRes.text();
  const createJson = createText ? JSON.parse(createText) : null;
  const sessionId = createJson?.data?.id;

  if (!sessionId) {
    throw new Error(`Failed to create Janus session: ${createText || `HTTP ${createRes.status}`}`);
  }

  let handleId: number | null = null;

  try {
    const attachRes = await fetchWithTimeout(`${baseUrl}/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        janus: 'attach',
        plugin,
        transaction: randomTransaction(),
      }),
    }, 5000);
    const attachText = await attachRes.text();
    const attachJson = attachText ? JSON.parse(attachText) : null;
    handleId = attachJson?.data?.id ?? null;

    if (!handleId) {
      throw new Error(`Failed to attach Janus plugin: ${attachText || `HTTP ${attachRes.status}`}`);
    }

    const messageRes = await fetchWithTimeout(`${baseUrl}/${sessionId}/${handleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        janus: 'message',
        body,
        transaction: randomTransaction(),
      }),
    }, 5000);
    const messageText = await messageRes.text();
    const messageJson = messageText ? JSON.parse(messageText) : null;

    if (messageJson?.janus === 'error') {
      throw new Error(messageJson?.error?.reason || JSON.stringify(messageJson));
    }

    return (messageJson?.plugindata?.data || messageJson?.data || messageJson) as T;
  } finally {
    if (handleId) {
      await fetchWithTimeout(`${baseUrl}/${sessionId}/${handleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ janus: 'detach', transaction: randomTransaction() }),
      }, 3000).catch(() => undefined);
    }

    await fetchWithTimeout(`${baseUrl}/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ janus: 'destroy', transaction: randomTransaction() }),
    }, 3000).catch(() => undefined);
  }
}

async function isJanusAvailable() {
  const baseUrl = `http://${JANUS_HOST}:${JANUS_HTTP_PORT}${JANUS_API_PATH}`;

  try {
    const createRes = await fetchWithTimeout(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ janus: 'create', transaction: randomTransaction() }),
    }, 4000);
    const createText = await createRes.text();
    const createJson = createText ? JSON.parse(createText) : null;
    const sessionId = createJson?.data?.id;

    if (!sessionId) {
      return false;
    }

    await fetchWithTimeout(`${baseUrl}/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ janus: 'destroy', transaction: randomTransaction() }),
    }, 3000).catch(() => undefined);

    return true;
  } catch {
    return false;
  }
}

async function getTalkbackForwarders() {
  try {
    const response = await forwardJanusRequest<{
      rtp_forwarders?: Array<{
        stream_id: number;
        ip?: string;
        port?: number;
      }>;
    }>('janus.plugin.audiobridge', {
      request: 'listforwarders',
      room: MEDIA_AUDIO_BRIDGE_ROOM,
      secret: MEDIA_AUDIO_BRIDGE_SECRET,
    });

    return (response.rtp_forwarders || []).filter((forwarder) =>
      forwarder.ip === MEDIA_AUDIO_BRIDGE_FORWARD_HOST &&
      Number(forwarder.port) === Number(MEDIA_AUDIO_BRIDGE_FORWARD_PORT),
    );
  } catch {
    return [];
  }
}

async function proxyRemoteGet(targetUrl: string) {
  const response = await fetchWithTimeout(targetUrl);
  const headers = new Headers();
  const contentType = response.headers.get('content-type');

  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

async function proxyRemoteJson(targetUrl: string) {
  const response = await fetchWithTimeout(targetUrl);
  const payload = await response.text();
  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');

  return new Response(payload, {
    status: response.status,
    headers,
  });
}

async function requestRemoteJson<T = any>(targetUrl: string, init?: RequestInit) {
  const response = await fetchWithTimeout(targetUrl, init);
  const payload = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
  const data = parseJsonPayload<T>(payload, response);

  if (!response.ok) {
    const detail = typeof data === 'object' && data && 'details' in data
      ? String((data as Record<string, unknown>).details)
      : payload || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return {
    data,
    contentType,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function jsonErrorResponse(c: any, error: unknown, fallbackError: string, status = 502) {
  return c.json({
    error: fallbackError,
    details: errorMessage(error),
  }, status);
}

async function proxyJanus(c: any) {
  try {
    const requestUrl = new URL(c.req.url);
    const suffix = c.req.path.replace('/api/media/janus', '');
    const targetUrl = new URL(`http://${JANUS_HOST}:${JANUS_HTTP_PORT}${JANUS_API_PATH}${suffix}`);
    targetUrl.search = requestUrl.search;

    const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer();
    const response = await fetchWithTimeout(targetUrl.toString(), {
      method: c.req.method,
      headers: {
        'Content-Type': c.req.header('content-type') || 'application/json',
      },
      body,
    }, 15000);

    const headers = new Headers();
    const contentType = response.headers.get('content-type');

    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to reach Janus upstream');
  }
}

// Ensure maps directory exists
if (!fs.existsSync(MAPS_DIR)) {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
}

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get config for Jetson and frontend
app.get('/api/config', (c) => {
  const requestUrl = new URL(c.req.url);
  const forwardedProto = c.req.header('x-forwarded-proto') || requestUrl.protocol.replace(':', '');
  const forwardedHost = c.req.header('x-forwarded-host') || c.req.header('host') || requestUrl.host;
  const publicOrigin = config?.frontend?.api_url || `${forwardedProto}://${forwardedHost}`;
  const publicWsOrigin = FRONTEND_WS_URL || `${forwardedProto === 'https' ? 'wss' : 'ws'}://${forwardedHost}/rosbridge/`;

  return c.json({
    serverUrl: publicOrigin,
    profile: configProfile,
    jetsonHost: JETSON_HOST,
    jetsonRosbridgePort: JETSON_ROSBRIDGE_PORT,
    rosbridgeUrl: publicWsOrigin,
    media: {
      janusBaseUrl: `${publicOrigin}/api/media/janus`,
      janusApiUrl: `${publicOrigin}/api/media/janus`,
      janusDemoBaseUrl: `${publicOrigin}/janus-demo`,
      janusScriptUrl: `/api/media/assets/${JANUS_SCRIPT_ASSET}`,
      streamingUrl: `${publicOrigin}/janus-demo${JANUS_STREAMING_PATH}`,
      audioBridgeUrl: `${publicOrigin}/janus-demo${JANUS_AUDIOBRIDGE_PATH}`,
      preferredVideoStreamId: Number(MEDIA_VIDEO_STREAM_ID) || 0,
      preferredAudioStreamId: Number(MEDIA_AUDIO_STREAM_ID) || 0,
      audioBridgeRoom: Number(MEDIA_AUDIO_BRIDGE_ROOM),
      audioBridgeDisplay: MEDIA_AUDIO_BRIDGE_DISPLAY,
    },
    face: {
      enabled: true,
      latestUrl: '/api/face/latest',
      healthUrl: '/api/face/health',
      pollIntervalMs: Number(FACE_POLL_INTERVAL_MS) || 500,
    },
    topics: {
      cmdVelTopic: config?.topics?.cmd_vel || '/cmd_vel',
      motionCmdTopic: config?.topics?.motion_cmd || '/diablo/MotionCmd',
      standCmdTopic: config?.topics?.stand_cmd || '/stand_cmd',
    },
    teleop: {
      standMode: Boolean(config?.teleop?.stand_mode ?? false),
      up: Number(config?.teleop?.up ?? 0.0),
      publishRateHz: Number(config?.teleop?.publish_rate_hz ?? 25),
    },
    navigation: {
      navigateToPoseAction: '/navigate_to_pose',
      navigateToPoseType: 'nav2_msgs/action/NavigateToPose',
      navigateThroughPosesAction: '/navigate_through_poses',
      navigateThroughPosesType: 'nav2_msgs/action/NavigateThroughPoses',
      frameId: 'map',
    },
  });
});

app.get('/api/settings', (c) => {
  const latest = loadCurrentRobotConfig();
  return c.json(buildSettingsPayload(latest.config));
});

app.post('/api/settings', async (c) => {
  const latest = loadCurrentRobotConfig();

  if (!latest.configPath) {
    return c.json({
      error: 'Config path is not available',
    }, 500);
  }

  try {
    const body = await c.req.json();
    const mergedConfig = mergeYamlConfig(latest.config, {
      jetson: {
        host: body?.jetson?.host,
        rosbridge_port: body?.jetson?.rosbridgePort,
      },
      media: {
        video_device: body?.media?.videoDevice,
        video_width: body?.media?.videoWidth,
        video_height: body?.media?.videoHeight,
        video_bitrate: body?.media?.videoBitrate,
        control_proxy_port: body?.media?.controlProxyPort,
        janus_http_port: body?.media?.janusHttpPort,
        janus_demo_port: body?.media?.janusDemoPort,
        audio_capture_device: body?.media?.audioCaptureDevice,
        audio_playback_device: body?.media?.audioPlaybackDevice,
      },
      face: {
        video_device: body?.face?.videoDevice,
        frame_width: body?.face?.frameWidth,
        frame_height: body?.face?.frameHeight,
        proxy_port: body?.face?.proxyPort,
        inference_interval_ms: body?.face?.intervalMs,
        score_threshold: body?.face?.scoreThreshold,
      },
      reverse_tunnel: {
        server_host: body?.reverseTunnel?.serverHost,
        rosbridge_port: body?.reverseTunnel?.rosbridgePort,
        media_control_port: body?.reverseTunnel?.mediaControlPort,
        face_port: body?.reverseTunnel?.facePort,
      },
    });

    saveYamlConfig(latest.configPath, mergedConfig);

    return c.json({
      success: true,
      settings: buildSettingsPayload(mergedConfig),
    });
  } catch (error) {
    return c.json({
      error: 'Failed to save settings',
      details: errorMessage(error),
    }, 500);
  }
});

app.post('/api/settings/apply-jetson', async (c) => {
  try {
    const latest = loadCurrentRobotConfig();
    const latestConfig = latest.config;
    const jetsonHost = asString(latestConfig.jetson?.host, asString(JETSON_HOST, '192.168.1.58'));
    const sshTarget = `${asString(latestConfig.jetson?.user, 'nvidia')}@${jetsonHost}`;

    const mediaControlUnitPath = asString(
      latestConfig.media?.control_unit_path,
      '/home/nvidia/.config/systemd/user/webbot-media-control.service',
    );
    const faceUnitPath = asString(
      latestConfig.face?.service_unit_path,
      '/home/nvidia/.config/systemd/user/webbot-face.service',
    );
    const mediaUnitPath = asString(
      latestConfig.media?.service_unit_path,
      '/home/nvidia/.config/systemd/user/webbot-media.service',
    );
    const videoUnitPath = asString(
      latestConfig.media?.video_unit_path,
      '/home/nvidia/.config/systemd/user/webbot-video.service',
    );
    const mediaScriptPath = asString(
      latestConfig.media?.service_script_path,
      '/home/nvidia/bin/webbot-media.sh',
    );
    const videoScriptPath = asString(
      latestConfig.media?.video_script_path,
      '/home/nvidia/bin/webbot-video.sh',
    );
    const mediaControlScriptPath = asString(
      latestConfig.media?.control_script_path,
      '/home/nvidia/bin/webbot-media-control.py',
    );
    const faceScriptPath = asString(
      latestConfig.face?.service_script_path,
      '/home/nvidia/bin/webbot-face-service.py',
    );
    const mediaEnvPath = '/home/nvidia/.config/webbot/media.env';
    const videoEnvPath = '/home/nvidia/.config/webbot/video.env';

    const mediaControlServiceName = asString(latestConfig.media?.control_service_name, 'webbot-media-control.service');
    const faceServiceName = asString(latestConfig.face?.service_name, 'webbot-face.service');
    const videoServiceName = asString(latestConfig.media?.video_service_name, 'webbot-video.service');
    const mediaServiceName = asString(latestConfig.media?.service_name, 'webbot-media.service');
    const restartStateFile = '/tmp/webbot-service-state.json';

    const mediaControlScript = fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-media-control.py'), 'utf-8');
    const faceScript = fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-face-service.py'), 'utf-8');
    const mediaScript = fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-media.sh'), 'utf-8');
    const videoScript = fs.readFileSync(path.join(process.cwd(), 'systemd', 'webbot-video.sh'), 'utf-8');

    const mediaUnit = renderMediaUnit();
    const videoUnit = renderVideoUnit();
    const mediaEnv = renderMediaEnv(latestConfig);
    const videoEnv = renderVideoEnv(latestConfig);

    await writeRemoteFiles(sshTarget, [
      { remotePath: mediaUnitPath, content: mediaUnit },
      { remotePath: videoUnitPath, content: videoUnit },
      { remotePath: mediaControlUnitPath, content: renderMediaControlUnit(latestConfig) },
      { remotePath: faceUnitPath, content: renderFaceUnit(latestConfig) },
      { remotePath: mediaScriptPath, content: mediaScript },
      { remotePath: videoScriptPath, content: videoScript },
      { remotePath: mediaControlScriptPath, content: mediaControlScript },
      { remotePath: faceScriptPath, content: faceScript },
      { remotePath: mediaEnvPath, content: mediaEnv },
      { remotePath: videoEnvPath, content: videoEnv },
    ]);

    const remoteApplyScript = [
      'import json, subprocess',
      `state_path = ${JSON.stringify(restartStateFile)}`,
      `services = ${JSON.stringify([mediaServiceName, mediaControlServiceName, faceServiceName, videoServiceName])}`,
      'states = {}',
      'for service in services:',
      "    result = subprocess.run(['systemctl', '--user', 'is-active', service], capture_output=True, text=True, check=False)",
      "    states[service] = result.stdout.strip() == 'active'",
      `subprocess.run(['chmod', '+x', ${JSON.stringify(mediaScriptPath)}, ${JSON.stringify(videoScriptPath)}, ${JSON.stringify(mediaControlScriptPath)}, ${JSON.stringify(faceScriptPath)}], check=False)`,
      "subprocess.run(['systemctl', '--user', 'daemon-reload'], check=False)",
      `always_restart = ${JSON.stringify([mediaServiceName, mediaControlServiceName])}`,
      `restart_if_active = ${JSON.stringify([faceServiceName, videoServiceName])}`,
      'for service in always_restart:',
      "    subprocess.run(['systemctl', '--user', 'restart', service], check=False)",
      'for service in restart_if_active:',
      '    if states.get(service):',
      "        subprocess.run(['systemctl', '--user', 'restart', service], check=False)",
    ].join('; ');

    await execAsync(`ssh ${sshTarget} python3 -c ${shellQuote(remoteApplyScript)}`);

    const { stdout, stderr } = await execAsync(
      `ssh ${sshTarget} ${shellQuote(
        `systemctl --user --no-pager --full status ${[
          mediaServiceName,
          mediaControlServiceName,
          faceServiceName,
          videoServiceName,
        ].map(shellQuote).join(' ')}`
      )}`,
    );

    return c.json({
      success: true,
      target: sshTarget,
      files: {
        mediaUnitPath,
        videoUnitPath,
        mediaControlUnitPath,
        faceUnitPath,
        mediaScriptPath,
        videoScriptPath,
        mediaControlScriptPath,
        faceScriptPath,
        mediaEnvPath,
        videoEnvPath,
      },
      generated: {
        mediaServiceExecStart: 'ExecStart=%h/bin/webbot-media.sh',
        videoServiceExecStart: 'ExecStart=%h/bin/webbot-video.sh',
        mediaControlExecStart: renderMediaControlExecStart(latestConfig),
        faceExecStart: renderFaceExecStart(latestConfig),
        mediaEnvironment: mediaEnv,
        videoEnvironment: videoEnv,
      },
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    });
  } catch (error) {
    return c.json({
      error: 'Failed to apply settings to Jetson',
      details: errorMessage(error),
    }, 500);
  }
});

app.get('/api/media/assets/*', async (c) => {
  const assetPath = c.req.path.replace('/api/media/assets/', '');
  const safeAssetPath = path.basename(assetPath);
  const remoteAssetBasePath = safeAssetPath === JANUS_SCRIPT_ASSET ? '/demos' : '';

  if (safeAssetPath === JANUS_SCRIPT_ASSET) {
    const localScriptPath = path.join(LOCAL_JANUS_DEMOS_DIR, JANUS_SCRIPT_ASSET);
    if (fs.existsSync(localScriptPath)) {
      return new Response(fs.readFileSync(localScriptPath), {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
      });
    }
  }

  if (safeAssetPath === JANUS_ADAPTER_ASSET) {
    return c.text('adapter asset is now loaded from the frontend bundle', 404);
  }

  try {
    return await proxyRemoteGet(`http://${JANUS_HOST}:${JANUS_DEMO_PORT}${remoteAssetBasePath}/${safeAssetPath}`);
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to fetch Janus asset', 404);
  }
});

app.all('/api/media/janus', proxyJanus);
app.all('/api/media/janus/*', proxyJanus);

app.get('/api/face/health', async (c) => {
  try {
    return await proxyRemoteJson(`http://${FACE_PROXY_HOST}:${FACE_PROXY_PORT}${FACE_HEALTH_PATH}`);
  } catch (error) {
    return c.json({
      online: false,
      error: String(error),
    });
  }
});

app.get('/api/face/latest', async (c) => {
  try {
    return await proxyRemoteJson(`http://${FACE_PROXY_HOST}:${FACE_PROXY_PORT}${FACE_API_PATH}`);
  } catch (error) {
    return c.json({
      online: false,
      updatedAt: null,
      frameWidth: 0,
      frameHeight: 0,
      faces: [],
      error: String(error),
    });
  }
});

app.get('/api/media/status', async (c) => {
  try {
    const janus = await isJanusAvailable();
    const forwarders = janus ? await getTalkbackForwarders() : [];
    let video: Record<string, unknown> | null = null;

    try {
      const response = await requestRemoteJson<{ video?: Record<string, unknown> }>(
        `http://${MEDIA_CONTROL_PROXY_HOST}:${MEDIA_CONTROL_PROXY_PORT}/status`,
      );
      video = response.data?.video || null;
    } catch {
      video = null;
    }

    return c.json({
      janus,
      talkbackForward: {
        active: forwarders.length > 0,
        streamId: forwarders[0]?.stream_id ?? null,
      },
      video,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to get media status');
  }
});

app.get('/api/media/video/status', async (c) => {
  try {
    const response = await requestRemoteJson(
      `http://${MEDIA_CONTROL_PROXY_HOST}:${MEDIA_CONTROL_PROXY_PORT}/status`,
    );
    return c.body(JSON.stringify(response.data), 200, {
      'Content-Type': response.contentType,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to get video status');
  }
});

app.post('/api/media/video/start', async (c) => {
  try {
    const response = await requestRemoteJson(
      `http://${MEDIA_CONTROL_PROXY_HOST}:${MEDIA_CONTROL_PROXY_PORT}/video/start`,
      { method: 'POST' },
    );
    return c.body(JSON.stringify(response.data), 200, {
      'Content-Type': response.contentType,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to start video pipeline');
  }
});

app.post('/api/media/video/stop', async (c) => {
  try {
    const response = await requestRemoteJson(
      `http://${MEDIA_CONTROL_PROXY_HOST}:${MEDIA_CONTROL_PROXY_PORT}/video/stop`,
      { method: 'POST' },
    );
    return c.body(JSON.stringify(response.data), 200, {
      'Content-Type': response.contentType,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to stop video pipeline');
  }
});

app.post('/api/media/talkback/forward/start', async (c) => {
  try {
    const existingForwarders = await getTalkbackForwarders();
    if (existingForwarders.length > 0) {
      return c.json({
        status: 'already_running',
        streamId: existingForwarders[0].stream_id,
      });
    }

    const response = await forwardJanusRequest<{
      stream_id: number;
      port: number;
      host: string;
    }>('janus.plugin.audiobridge', {
      request: 'rtp_forward',
      room: MEDIA_AUDIO_BRIDGE_ROOM,
      secret: MEDIA_AUDIO_BRIDGE_SECRET,
      host: MEDIA_AUDIO_BRIDGE_FORWARD_HOST,
      port: MEDIA_AUDIO_BRIDGE_FORWARD_PORT,
      codec: 'opus',
      ptype: 111,
    });

    return c.json({
      status: 'started',
      streamId: response.stream_id,
      host: response.host,
      port: response.port,
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to start talkback forwarder');
  }
});

app.post('/api/media/talkback/forward/stop', async (c) => {
  try {
    const forwarders = await getTalkbackForwarders();

    for (const forwarder of forwarders) {
      await forwardJanusRequest('janus.plugin.audiobridge', {
        request: 'stop_rtp_forward',
        room: MEDIA_AUDIO_BRIDGE_ROOM,
        secret: MEDIA_AUDIO_BRIDGE_SECRET,
        stream_id: forwarder.stream_id,
      });
    }

    return c.json({
      status: 'stopped',
      stopped: forwarders.map((forwarder) => forwarder.stream_id),
    });
  } catch (error) {
    return jsonErrorResponse(c, error, 'Failed to stop talkback forwarder');
  }
});

// Get list of saved maps
app.get('/api/maps', async (c) => {
  try {
    const files = fs.readdirSync(MAPS_DIR);
    const maps = files
      .filter(f => f.endsWith('.yaml'))
      .map(f => {
        const stats = fs.statSync(path.join(MAPS_DIR, f));
        return {
          name: f.replace('.yaml', ''),
          filename: f,
          path: path.join(MAPS_DIR, f),
          created: stats.birthtime.toISOString(),
        };
      });
    return c.json({ maps });
  } catch (error) {
    return c.json({ error: 'Failed to list maps', details: String(error) }, 500);
  }
});

// Get static map data (for navigation mode - loads once, no updates from robot)
app.get('/api/maps/:name/data', async (c) => {
  try {
    const mapName = c.req.param('name');
    const yamlPath = path.join(MAPS_DIR, `${mapName}.yaml`);
    const pgmPath = path.join(MAPS_DIR, `${mapName}.pgm`);

    if (!fs.existsSync(yamlPath) || !fs.existsSync(pgmPath)) {
      return c.json({ error: 'Map not found', details: `yaml: ${yamlPath}, pgm: ${pgmPath}` }, 404);
    }

    // Read YAML metadata
    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    const yamlData: Record<string, any> = {};

    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        const value = match[2].trim();
        if (value.startsWith('[') && value.endsWith(']')) {
          yamlData[key] = value.slice(1, -1).split(',').map((v: string) => parseFloat(v.trim()));
        } else if (!isNaN(Number(value))) {
          yamlData[key] = Number(value);
        } else {
          yamlData[key] = value;
        }
      }
    }

    // Read PGM file
    const pgmBuffer = fs.readFileSync(pgmPath);

    // Find header end (look for first newline after magic "P5")
    let headerEnd = 0;
    let lineIdx = 0;
    for (let i = 0; i < pgmBuffer.length && lineIdx < 3; i++) {
      if (pgmBuffer[i] === 0x0A) {
        lineIdx++;
        headerEnd = i + 1;
      }
    }

    // Parse dimensions from header
    const headerStr = pgmBuffer.slice(0, headerEnd).toString('ascii');
    const headerLines = headerStr.split('\n').filter(l => l.trim() && !l.startsWith('P'));
    const dims = headerLines[0].trim().split(/\s+/);
    const width = parseInt(dims[0]);
    const height = parseInt(dims[1]);
    const maxVal = parseInt(headerLines[1].trim());

    // Extract image data
    const imageData: number[] = [];
    for (let i = headerEnd; i < pgmBuffer.length; i++) {
      const val = pgmBuffer[i];
      // Convert: PGM 0=black(occupied), maxVal=white(free) → OccupancyGrid 100=occupied, 0=free
      const occupied = Math.round(100 - (val / maxVal) * 100);
      imageData.push(occupied);
    }

    return c.json({
      header: {
        stamp: { sec: Math.floor(Date.now() / 1000), nsec: 0 },
        frame_id: 'map'
      },
      info: {
        map_load_time: { sec: Math.floor(Date.now() / 1000), nsec: 0 },
        resolution: yamlData.resolution || 0.05,
        width: width,
        height: height,
        origin: {
          position: {
            x: yamlData.origin?.[0] || 0,
            y: yamlData.origin?.[1] || 0,
            z: yamlData.origin?.[2] || 0
          },
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        }
      },
      data: imageData
    });
  } catch (error) {
    return c.json({ error: 'Failed to load map', details: String(error) }, 500);
  }
});

// Upload map from Jetson via HTTP (JSON with base64)
app.post('/api/maps/upload', async (c) => {
  try {
    const body = await c.req.json();
    const { name, yaml, pgm } = body;

    if (!name || !yaml || !pgm) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const localYamlPath = path.join(MAPS_DIR, `${name}.yaml`);
    const localPgmPath = path.join(MAPS_DIR, `${name}.pgm`);

    // Save files
    fs.writeFileSync(localYamlPath, yaml, 'utf-8');
    const pgmBuffer = Buffer.from(pgm, 'base64');
    fs.writeFileSync(localPgmPath, pgmBuffer);

    console.log('[upload] Map saved:', name);

    return c.json({
      success: true,
      map: { name, yamlPath: localYamlPath, pgmPath: localPgmPath }
    });
  } catch (error) {
    console.error('[upload] Error:', error);
    return c.json({ error: 'Failed to upload map', details: String(error) }, 500);
  }
});

// Delete map
app.delete('/api/maps/:name', async (c) => {
  try {
    const mapName = c.req.param('name');
    const mapYamlPath = path.join(MAPS_DIR, `${mapName}.yaml`);
    const mapPgmPath = path.join(MAPS_DIR, `${mapName}.pgm`);

    if (fs.existsSync(mapYamlPath)) {
      fs.unlinkSync(mapYamlPath);
    }
    if (fs.existsSync(mapPgmPath)) {
      fs.unlinkSync(mapPgmPath);
    }

    return c.json({ status: 'deleted', name: mapName });
  } catch (error) {
    return c.json({ error: 'Failed to delete map', details: String(error) }, 500);
  }
});

// Check SLAM status
app.get('/api/slam/status', async (c) => {
  try {
    // Check for tmux session first
    let tmuxRunning = false;
    try {
      execSync('tmux has-session -t webbot_viz 2>/dev/null', { stdio: 'ignore' });
      tmuxRunning = true;
    } catch {
      tmuxRunning = false;
    }

    // Also check for actual slam_toolbox processes or map publisher
    const { stdout } = await execAsync('pgrep -a slam_toolbox || true');
    let slamRunning = stdout.trim().length > 0 && !stdout.includes('grep');

    // Alternative: check if map topic has publishers
    if (!slamRunning) {
      try {
        execSync('ros2 topic info /map 2>/dev/null | grep "Publisher count: [1-9]"', { stdio: 'ignore' });
        slamRunning = true;
      } catch {
        slamRunning = false;
      }
    }

    return c.json({ running: slamRunning, tmux: tmuxRunning });
  } catch {
    return c.json({ running: false, tmux: false });
  }
});

// Get server network info
app.get('/api/network', async (c) => {
  try {
    const { stdout } = await execAsync('hostname -I 2>/dev/null || ip addr show | grep inet | grep -v 127.0.0.1 | head -1');
    const ips = stdout.trim().split(' ').filter(ip => ip.match(/\d+\.\d+\.\d+\.\d+/));

    return c.json({
      ips,
      hostname: os.hostname(),
      port: PORT,
    });
  } catch {
    return c.json({ ips: ['localhost'], hostname: 'localhost', port: PORT });
  }
});

const PORT = process.env.PORT || SERVER_PORT || 4001;

console.log(`Server running on http://0.0.0.0:${PORT}`);

export default {
  port: PORT,
  hostname: '0.0.0.0',
  idleTimeout: 60,
  fetch: app.fetch,
};
