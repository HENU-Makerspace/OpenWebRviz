import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { exec, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const app = new Hono();

const MAPS_DIR = path.join(process.cwd(), 'maps');
const SLAM_PROCESS_FILE = path.join(process.cwd(), '.slam_pid');
const ROSBRIDGE_PROCESS_FILE = path.join(process.cwd(), '.rosbridge_pid');

// Config file path
const CONFIG_PATH = path.join(process.cwd(), 'config', 'robot_config.yaml');

// Simple YAML config parser
function parseYamlConfig(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config: Record<string, any> = {};

    // Simple line-by-line parsing for flat YAML structure
    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Section header (no colon or colon at end)
      if (trimmed.endsWith(':') && !trimmed.includes('"') && !trimmed.includes("'")) {
        currentSection = trimmed.replace(':', '').trim();
        config[currentSection] = {};
        continue;
      }

      // Key-value pair
      const match = trimmed.match(/^(\w+):\s*(.+)$/);
      if (match && currentSection) {
        let value = match[2].trim().replace(/^["']|["']$/g, '');
        // Try to parse as number (skip if contains dot, e.g. IP addresses)
        const num = parseFloat(value);
        config[currentSection][match[1]] = (isNaN(num) || value.includes('.')) ? value : num;
      }
    }

    return config;
  } catch (e) {
    console.error('Failed to parse config:', e);
    return null;
  }
}

// Load config
const config = parseYamlConfig(CONFIG_PATH);

// Server configuration
const SERVER_HOST = config?.server?.host || process.env.SERVER_HOST || '192.168.1.100';
const SERVER_PORT = config?.server?.port || process.env.SERVER_PORT || 4001;

// Jetson configuration
const JETSON_HOST = config?.jetson?.host || process.env.JETSON_HOST || '192.168.1.58';
const JETSON_USER = config?.jetson?.user || process.env.JETSON_USER || 'nvidia';
const JETSON_MAPS_DIR = config?.jetson?.maps_dir || '/home/nvidia/maps';
const JETSON_ROSBRIDGE_PORT = config?.jetson?.rosbridge_port || 9090;
const JANUS_HOST = config?.media?.janus_host || JETSON_HOST;
const JANUS_HTTP_PORT = config?.media?.janus_http_port || 8088;
const JANUS_API_PATH = config?.media?.janus_api_path || '/janus';
const JANUS_DEMO_PORT = config?.media?.janus_demo_port || 8000;
const JANUS_STREAMING_PATH = config?.media?.streaming_path || '/demos/streaming.html#';
const JANUS_AUDIOBRIDGE_PATH = config?.media?.audiobridge_path || '/demos/audiobridge.html';
const JANUS_BINARY = config?.media?.janus_binary || '/opt/janus/bin/janus';
const JANUS_HTML_DIR = config?.media?.janus_html_dir || '/opt/janus/share/janus/html';
const JANUS_ADAPTER_ASSET = config?.media?.adapter_asset || 'adapter.min.js';
const JANUS_SCRIPT_ASSET = config?.media?.janus_script_asset || 'janus.js';
const MEDIA_AUDIO_CAPTURE_DEVICE = config?.media?.audio_capture_device || 'plughw:CARD=UACDemoV10,DEV=0';
const MEDIA_AUDIO_PLAYBACK_DEVICE = config?.media?.audio_playback_device || 'hw:0,0';
const MEDIA_AUDIO_CAPTURE_PORT = config?.media?.audio_capture_port || 5005;
const MEDIA_AUDIO_PLAYBACK_PORT = config?.media?.audio_playback_port || 5006;
const MEDIA_VIDEO_DEVICE = config?.media?.video_device || '/dev/video0';
const MEDIA_VIDEO_PORT = config?.media?.video_port || 8004;
const MEDIA_VIDEO_BITRATE = config?.media?.video_bitrate || 4000;
const MEDIA_VIDEO_STREAM_ID = config?.media?.preferred_video_stream_id || 0;
const MEDIA_AUDIO_STREAM_ID = config?.media?.preferred_audio_stream_id || 0;
const MEDIA_AUDIO_BRIDGE_ROOM = config?.media?.audiobridge_room || 1234;
const MEDIA_AUDIO_BRIDGE_SECRET = config?.media?.audiobridge_secret || 'adminpwd';
const MEDIA_AUDIO_BRIDGE_FORWARD_HOST = config?.media?.audiobridge_forward_host || '127.0.0.1';
const MEDIA_AUDIO_BRIDGE_FORWARD_PORT = config?.media?.audiobridge_forward_port || MEDIA_AUDIO_PLAYBACK_PORT;
const MEDIA_AUDIO_BRIDGE_DISPLAY = config?.media?.audiobridge_display || 'webbot-ui';

console.log('[Config] Loaded config:', {
  SERVER_HOST,
  JETSON_HOST,
  JETSON_ROSBRIDGE_PORT,
  JANUS_HOST,
  JANUS_HTTP_PORT,
  JANUS_API_PATH,
  JANUS_DEMO_PORT,
});

function randomTransaction() {
  return Math.random().toString(36).slice(2, 12);
}

function parseTruthyFlag(value: string | undefined) {
  return value?.trim() === '1';
}

async function runRemoteCommand(command: string) {
  return execFileAsync('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    `${JETSON_USER}@${JETSON_HOST}`,
    'bash',
    '-lc',
    command,
  ]);
}

async function getRemoteMediaStatus() {
  const script = `
printf 'janus=%s\n' "$(pgrep -f '${JANUS_BINARY}' >/dev/null && echo 1 || echo 0)"
printf 'demo_server=%s\n' "$(pgrep -f 'python3 -m http.server ${JANUS_DEMO_PORT}' >/dev/null && echo 1 || echo 0)"
printf 'video_pipeline=%s\n' "$(pgrep -f 'gst-launch-1.0.*port=${MEDIA_VIDEO_PORT}' >/dev/null && echo 1 || echo 0)"
printf 'audio_capture=%s\n' "$(pgrep -f 'gst-launch-1.0.*port=${MEDIA_AUDIO_CAPTURE_PORT}' >/dev/null && echo 1 || echo 0)"
printf 'audio_playback=%s\n' "$(pgrep -f 'gst-launch-1.0.*port=${MEDIA_AUDIO_PLAYBACK_PORT}' >/dev/null && echo 1 || echo 0)"
`;

  const { stdout } = await runRemoteCommand(script);
  const parsed = Object.fromEntries(
    stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, rawValue] = line.split('=');
        return [key, parseTruthyFlag(rawValue)];
      }),
  );

  return {
    janus: Boolean(parsed.janus),
    demoServer: Boolean(parsed.demo_server),
    videoPipeline: Boolean(parsed.video_pipeline),
    audioCapture: Boolean(parsed.audio_capture),
    audioPlayback: Boolean(parsed.audio_playback),
  };
}

async function forwardJanusRequest<T = any>(plugin: string, body: Record<string, unknown>) {
  const baseUrl = `http://${JANUS_HOST}:${JANUS_HTTP_PORT}${JANUS_API_PATH}`;

  const createRes = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ janus: 'create', transaction: randomTransaction() }),
  });
  const createJson = await createRes.json();
  const sessionId = createJson?.data?.id;

  if (!sessionId) {
    throw new Error(`Failed to create Janus session: ${JSON.stringify(createJson)}`);
  }

  let handleId: number | null = null;

  try {
    const attachRes = await fetch(`${baseUrl}/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        janus: 'attach',
        plugin,
        transaction: randomTransaction(),
      }),
    });
    const attachJson = await attachRes.json();
    handleId = attachJson?.data?.id ?? null;

    if (!handleId) {
      throw new Error(`Failed to attach Janus plugin: ${JSON.stringify(attachJson)}`);
    }

    const messageRes = await fetch(`${baseUrl}/${sessionId}/${handleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        janus: 'message',
        body,
        transaction: randomTransaction(),
      }),
    });
    const messageJson = await messageRes.json();

    if (messageJson?.janus === 'error') {
      throw new Error(messageJson?.error?.reason || JSON.stringify(messageJson));
    }

    return (messageJson?.plugindata?.data || messageJson?.data || messageJson) as T;
  } finally {
    if (handleId) {
      await fetch(`${baseUrl}/${sessionId}/${handleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ janus: 'detach', transaction: randomTransaction() }),
      }).catch(() => undefined);
    }

    await fetch(`${baseUrl}/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ janus: 'destroy', transaction: randomTransaction() }),
    }).catch(() => undefined);
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
  const response = await fetch(targetUrl);
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

async function proxyJanus(c: any) {
  const requestUrl = new URL(c.req.url);
  const suffix = c.req.path.replace('/api/media/janus', '');
  const targetUrl = new URL(`http://${JANUS_HOST}:${JANUS_HTTP_PORT}${JANUS_API_PATH}${suffix}`);
  targetUrl.search = requestUrl.search;

  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer();
  const response = await fetch(targetUrl.toString(), {
    method: c.req.method,
    headers: {
      'Content-Type': c.req.header('content-type') || 'application/json',
    },
    body,
  });

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
  return c.json({
    serverUrl: `http://${SERVER_HOST}:${SERVER_PORT}`,
    jetsonHost: JETSON_HOST,
    jetsonRosbridgePort: JETSON_ROSBRIDGE_PORT,
    media: {
      janusBaseUrl: `http://${JANUS_HOST}:${JANUS_HTTP_PORT}`,
      janusApiUrl: '/api/media/janus',
      janusDemoBaseUrl: `http://${JANUS_HOST}:${JANUS_DEMO_PORT}`,
      adapterScriptUrl: `/api/media/assets/${JANUS_ADAPTER_ASSET}`,
      janusScriptUrl: `/api/media/assets/${JANUS_SCRIPT_ASSET}`,
      streamingUrl: `http://${JANUS_HOST}:${JANUS_DEMO_PORT}${JANUS_STREAMING_PATH}`,
      audioBridgeUrl: `http://${JANUS_HOST}:${JANUS_DEMO_PORT}${JANUS_AUDIOBRIDGE_PATH}`,
      preferredVideoStreamId: Number(MEDIA_VIDEO_STREAM_ID) || 0,
      preferredAudioStreamId: Number(MEDIA_AUDIO_STREAM_ID) || 0,
      audioBridgeRoom: Number(MEDIA_AUDIO_BRIDGE_ROOM),
      audioBridgeDisplay: MEDIA_AUDIO_BRIDGE_DISPLAY,
    },
  });
});

app.get('/api/media/assets/*', async (c) => {
  const assetPath = c.req.path.replace('/api/media/assets/', '');
  return proxyRemoteGet(`http://${JANUS_HOST}:${JANUS_DEMO_PORT}/${assetPath}`);
});

app.all('/api/media/janus', proxyJanus);
app.all('/api/media/janus/*', proxyJanus);

app.get('/api/media/status', async (c) => {
  try {
    const service = await getRemoteMediaStatus();
    const forwarders = service.janus ? await getTalkbackForwarders() : [];

    return c.json({
      service,
      talkbackForward: {
        active: forwarders.length > 0,
        streamId: forwarders[0]?.stream_id ?? null,
      },
    });
  } catch (error) {
    return c.json({ error: 'Failed to get media status', details: String(error) }, 500);
  }
});

app.post('/api/media/start', async (c) => {
  try {
    const script = `
ensure_shell_process() {
  local pattern="$1"
  local logfile="$2"
  local command="$3"
  if ! pgrep -f "$pattern" >/dev/null; then
    nohup bash -lc "$command" >"$logfile" 2>&1 &
    sleep 1
  fi
}

ensure_shell_process "${JANUS_BINARY}" /tmp/webbot-janus.log "${JANUS_BINARY}"
ensure_shell_process "python3 -m http.server ${JANUS_DEMO_PORT}" /tmp/webbot-janus-http.log "python3 -m http.server ${JANUS_DEMO_PORT} --directory ${JANUS_HTML_DIR}"
ensure_shell_process "gst-launch-1.0.*port=${MEDIA_AUDIO_CAPTURE_PORT}" /tmp/webbot-audio-capture.log "gst-launch-1.0 -v alsasrc device=\\"${MEDIA_AUDIO_CAPTURE_DEVICE}\\" ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host=127.0.0.1 port=${MEDIA_AUDIO_CAPTURE_PORT}"
ensure_shell_process "gst-launch-1.0.*port=${MEDIA_AUDIO_PLAYBACK_PORT}" /tmp/webbot-audio-playback.log "gst-launch-1.0 -v udpsrc port=${MEDIA_AUDIO_PLAYBACK_PORT} caps=\\"application/x-rtp, media=(string)audio, clock-rate=(int)48000, encoding-name=(string)OPUS, payload=(int)111\\" ! queue ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! alsasink device=${MEDIA_AUDIO_PLAYBACK_DEVICE}"
ensure_shell_process "gst-launch-1.0.*port=${MEDIA_VIDEO_PORT}" /tmp/webbot-video.log "gst-launch-1.0 v4l2src device=${MEDIA_VIDEO_DEVICE} do-timestamp=true ! jpegdec ! nvvideoconvert ! 'video/x-raw,format=I420' ! x264enc bitrate=${MEDIA_VIDEO_BITRATE} tune=zerolatency speed-preset=ultrafast ! rtph264pay config-interval=1 pt=96 ! udpsink host=127.0.0.1 port=${MEDIA_VIDEO_PORT}"
`;

    await runRemoteCommand(script);
    const service = await getRemoteMediaStatus();

    return c.json({ status: 'started', service });
  } catch (error) {
    return c.json({ error: 'Failed to start media services', details: String(error) }, 500);
  }
});

app.post('/api/media/stop', async (c) => {
  try {
    const forwarders = await getTalkbackForwarders();

    for (const forwarder of forwarders) {
      await forwardJanusRequest('janus.plugin.audiobridge', {
        request: 'stop_rtp_forward',
        room: MEDIA_AUDIO_BRIDGE_ROOM,
        stream_id: forwarder.stream_id,
      }).catch(() => undefined);
    }

    const script = `
pkill -f "${JANUS_BINARY}" || true
pkill -f "python3 -m http.server ${JANUS_DEMO_PORT}" || true
pkill -f "gst-launch-1.0.*port=${MEDIA_AUDIO_CAPTURE_PORT}" || true
pkill -f "gst-launch-1.0.*port=${MEDIA_AUDIO_PLAYBACK_PORT}" || true
pkill -f "gst-launch-1.0.*port=${MEDIA_VIDEO_PORT}" || true
`;

    await runRemoteCommand(script);

    return c.json({ status: 'stopped' });
  } catch (error) {
    return c.json({ error: 'Failed to stop media services', details: String(error) }, 500);
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
    return c.json({ error: 'Failed to start talkback forwarder', details: String(error) }, 500);
  }
});

app.post('/api/media/talkback/forward/stop', async (c) => {
  try {
    const forwarders = await getTalkbackForwarders();

    for (const forwarder of forwarders) {
      await forwardJanusRequest('janus.plugin.audiobridge', {
        request: 'stop_rtp_forward',
        room: MEDIA_AUDIO_BRIDGE_ROOM,
        stream_id: forwarder.stream_id,
      });
    }

    return c.json({
      status: 'stopped',
      stopped: forwarders.map((forwarder) => forwarder.stream_id),
    });
  } catch (error) {
    return c.json({ error: 'Failed to stop talkback forwarder', details: String(error) }, 500);
  }
});

// Check rosbridge status
app.get('/api/rosbridge/status', async (c) => {
  try {
    const { stdout } = await execAsync('pgrep -f rosbridge_websocket || true');
    const isRunning = stdout.trim().length > 0;
    return c.json({ running: isRunning });
  } catch {
    return c.json({ running: false });
  }
});

// Start rosbridge
app.post('/api/rosbridge/start', async (c) => {
  try {
    // Check if already running
    const { stdout } = await execAsync('pgrep -f rosbridge_websocket || true');
    if (stdout.trim().length > 0) {
      return c.json({ status: 'already_running' });
    }

    // Start rosbridge
    const cmd = 'ros2 launch rosbridge_server rosbridge_websocket_launch.xml &';
    exec(cmd);

    await new Promise(resolve => setTimeout(resolve, 2000));

    return c.json({ status: 'started' });
  } catch (error) {
    return c.json({ error: 'Failed to start rosbridge', details: String(error) }, 500);
  }
});

// Stop rosbridge
app.post('/api/rosbridge/stop', async (c) => {
  try {
    exec('pkill -f rosbridge_websocket');
    return c.json({ status: 'stopped' });
  } catch {
    return c.json({ status: 'error' });
  }
});

app.get('/api/ros-topics', (c) => {
  return c.json({
    topics: [],
    message: 'ROS connection is handled client-side via rosbridge_websocket'
  });
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

// Get slam config
app.get('/api/slam-config', async (c) => {
  try {
    // Try local config first (packages/server/config/)
    const localConfig = path.join(process.cwd(), 'config', 'slam_default.yaml');
    if (fs.existsSync(localConfig)) {
      const content = fs.readFileSync(localConfig, 'utf-8');
      return c.json({ configPath: localConfig, content });
    }

    // Try to find slam config in common system locations
    const configPaths = [
      '/opt/ros/humble/share/slam_toolbox/params/mapper_params_online_async.yaml',
      '/opt/ros/humble/share/slam_toolbox/params/mapper_params_offline.yaml',
      '/usr/share/slam_toolbox/params/mapper_params_online_async.yaml',
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return c.json({ configPath, content: content.substring(0, 1000) });
      }
    }

    // Return default config
    return c.json({
      configPath: 'default',
      content: 'lidar_frame: laser\nodom_frame: odom\nmap_frame: map\nmode: mapping\n',
    });
  } catch (error) {
    return c.json({ error: 'Failed to get config', details: String(error) }, 500);
  }
});

// Start SLAM
app.post('/api/slam/start', async (c) => {
  try {
    const body = await c.req.json();

    // Find config file - use local first, then system
    let configPath = body.configPath;
    if (!configPath || configPath === 'default') {
      const localConfig = path.join(process.cwd(), 'config', 'slam_default.yaml');
      if (fs.existsSync(localConfig)) {
        configPath = localConfig;
      } else {
        configPath = '/opt/ros/humble/share/slam_toolbox/params/mapper_params_online_async.yaml';
      }
    }

    // Kill existing slam if running
    if (fs.existsSync(SLAM_PROCESS_FILE)) {
      const pid = fs.readFileSync(SLAM_PROCESS_FILE, 'utf-8').trim();
      try {
        exec(`kill ${pid}`);
        console.log(`Killed existing SLAM process ${pid}`);
      } catch {}
    }

    // Start slam_toolbox
    const cmd = `ros2 launch slam_toolbox online_async_launch.py params_file:=${configPath} use_sim_time:=true &`;
    console.log('Starting SLAM with config:', configPath);
    exec(cmd);

    // Save PID
    const { stdout } = await execAsync('pgrep -f "slam_toolbox" | head -1');
    const pid = stdout.trim();
    if (pid) {
      fs.writeFileSync(SLAM_PROCESS_FILE, pid);
    }

    return c.json({ status: 'started', pid });
  } catch (error) {
    return c.json({ error: 'Failed to start SLAM', details: String(error) }, 500);
  }
});

// Stop SLAM
app.post('/api/slam/stop', async (c) => {
  try {
    if (fs.existsSync(SLAM_PROCESS_FILE)) {
      const pid = fs.readFileSync(SLAM_PROCESS_FILE, 'utf-8').trim();
      try {
        exec(`kill ${pid}`);
      } catch {}
      fs.unlinkSync(SLAM_PROCESS_FILE);
    }

    // Also try to kill by process name
    try {
      exec('pkill -f slam_toolbox');
    } catch {}

    return c.json({ status: 'stopped' });
  } catch (error) {
    return c.json({ error: 'Failed to stop SLAM', details: String(error) }, 500);
  }
});

// Save map
app.post('/api/maps/save', async (c) => {
  try {
    const body = await c.req.json();
    const mapName = body.name || `map_${Date.now()}`;
    const mapYamlPath = path.join(MAPS_DIR, `${mapName}.yaml`);
    const mapPgmPath = path.join(MAPS_DIR, `${mapName}.pgm`);

    // Use map_saver_cli to save the map
    const cmd = `ros2 run nav2_map_server map_saver_cli -f ${path.join(MAPS_DIR, mapName)}`;
    try {
      execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
      console.error('Map saver error:', e);
    }

    // Wait a bit for map to be saved
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if files exist
    const yamlExists = fs.existsSync(mapYamlPath);
    const pgmExists = fs.existsSync(mapPgmPath);

    if (!yamlExists) {
      return c.json({ error: 'Failed to save map files' }, 500);
    }

    return c.json({
      status: 'saved',
      map: {
        name: mapName,
        yamlPath: mapYamlPath,
        pgmPath: mapPgmPath,
      }
    });
  } catch (error) {
    return c.json({ error: 'Failed to save map', details: String(error) }, 500);
  }
});

// Sync map from Jetson to server
app.post('/api/maps/sync-from-robot', async (c) => {
  console.log('[sync-from-robot] Received request, JETSON_HOST:', JETSON_HOST, 'JETSON_USER:', JETSON_USER);
  try {
    const body = await c.req.json();
    const mapName = body.name;
    console.log('[sync-from-robot] Map name:', mapName);

    if (!mapName) {
      return c.json({ error: 'Map name is required' }, 400);
    }

    const localYamlPath = path.join(MAPS_DIR, `${mapName}.yaml`);
    const localPgmPath = path.join(MAPS_DIR, `${mapName}.pgm`);

    // Check if already exists locally
    if (fs.existsSync(localYamlPath) && fs.existsSync(localPgmPath)) {
      console.log('[sync-from-robot] Map already exists locally');
      return c.json({
        status: 'exists',
        map: { name: mapName, yamlPath: localYamlPath, pgmPath: localPgmPath }
      });
    }

    // Copy from Jetson using scp
    const remotePath = `${JETSON_USER}@${JETSON_HOST}:${JETSON_MAPS_DIR}/${mapName}`;
    console.log('[sync-from-robot] SCP from:', remotePath);

    try {
      // Copy YAML file
      await execAsync(`scp ${remotePath}.yaml ${localYamlPath}`);
      // Copy PGM file
      await execAsync(`scp ${remotePath}.pgm ${localPgmPath}`);
      console.log('[sync-from-robot] SCP completed');
    } catch (e) {
      console.error('[sync-from-robot] SCP error:', e);
      return c.json({ error: 'Failed to copy map from robot', details: String(e) }, 500);
    }

    return c.json({
      status: 'synced',
      map: { name: mapName, yamlPath: localYamlPath, pgmPath: localPgmPath }
    });
  } catch (error) {
    console.error('[sync-from-robot] Error:', error);
    return c.json({ error: 'Failed to sync map', details: String(error) }, 500);
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

// Start with tmux session
app.post('/api/slam/start-tmux', async (c) => {
  try {
    const body = await c.req.json();
    const scriptPath = body.scriptPath || path.join(process.cwd(), '..', '..', 'start_webbot_viz.sh');

    // Kill existing slam first
    try {
      exec('pkill -f slam_toolbox');
      exec('pkill -f start_webbot_viz');
    } catch {}

    // Check if tmux session exists and kill it
    try {
      exec('tmux kill-session -t webbot_viz 2>/dev/null || true');
    } catch {}

    // Create new tmux session and run script
    const cmd = `tmux new -s webbot_viz -d "bash ${scriptPath}"`;
    exec(cmd);

    // Wait a moment for script to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Save PID info
    const { stdout } = await execAsync('pgrep -f start_webbot_viz | head -1 || true');
    if (stdout.trim()) {
      fs.writeFileSync(SLAM_PROCESS_FILE, stdout.trim());
    }

    return c.json({ status: 'started', session: 'webbot_viz', script: scriptPath });
  } catch (error) {
    return c.json({ error: 'Failed to start tmux', details: String(error) }, 500);
  }
});

// Stop tmux session
app.post('/api/slam/stop-tmux', async (c) => {
  try {
    // Kill TMUX session first
    try {
      exec('tmux kill-session -t webbot_viz 2>/dev/null || true');
    } catch {}

    // Kill all related processes - be more aggressive
    try {
      exec('pkill -f start_webbot_viz');
    } catch {}
    try {
      exec('pkill -f slam_toolbox');
    } catch {}
    try {
      exec('pkill -f turtlebot3_gazebo');
    } catch {}
    try {
      exec('pkill -f "gz sim"');
    } catch {}

    if (fs.existsSync(SLAM_PROCESS_FILE)) {
      fs.unlinkSync(SLAM_PROCESS_FILE);
    }

    return c.json({ status: 'stopped' });
  } catch (error) {
    return c.json({ error: 'Failed to stop tmux', details: String(error) }, 500);
  }
});

// Navigation status
app.get('/api/navigation/status', async (c) => {
  try {
    let navRunning = false;
    try {
      execSync('tmux has-session -t webbot_nav 2>/dev/null', { stdio: 'ignore' });
      navRunning = true;
    } catch {
      navRunning = false;
    }

    // Check for nav2 processes
    const { stdout } = await execAsync('pgrep -a nav2_bringup || true');
    const running = stdout.trim().length > 0;

    return c.json({ running: running || navRunning, tmux: navRunning });
  } catch {
    return c.json({ running: false, tmux: false });
  }
});

// Start navigation with TMUX
app.post('/api/navigation/start-tmux', async (c) => {
  try {
    const body = await c.req.json();
    const mapName = body.mapName;

    if (!mapName) {
      return c.json({ error: 'mapName is required' }, 400);
    }

    const mapYamlPath = path.join(MAPS_DIR, `${mapName}.yaml`);
    if (!fs.existsSync(mapYamlPath)) {
      return c.json({ error: 'Map file not found' }, 404);
    }

    // Kill existing navigation first
    try {
      exec('tmux kill-session -t webbot_nav 2>/dev/null || true');
    } catch {}

    // Create navigation script that loads the map
    const navScriptPath = path.join(process.cwd(), 'start_navigation.sh');

    const navScript = `#!/bin/bash

# Cleanup function to kill all child processes
cleanup() {
    echo "Stopping navigation..."
    pkill -f nav2_bringup 2>/dev/null
    pkill -f navigation_launch 2>/dev/null
    pkill -f robot_state_publisher 2>/dev/null
    pkill -f turtlebot3_gazebo 2>/dev/null
    pkill -f "gz sim" 2>/dev/null
    exit 0
}

trap cleanup SIGHUP SIGTERM EXIT

source /opt/ros/jazzy/setup.bash
export TURTLEBOT3_MODEL=burger

MAP_YAML_PATH="${mapYamlPath}"
echo "Starting navigation with map: ${mapYamlPath}"

# Get robot description from turtlebot3 description (plain URDF, not xacro)
TURTLEBOT3_URDF=$(ros2 pkg prefix turtlebot3_description)/share/turtlebot3_description/urdf/turtlebot3_burger.urdf
export ROBOT_DESCRIPTION=$(cat $TURTLEBOT3_URDF)

# Start Gazebo if not running
if ! pgrep -f "gz sim" > /dev/null; then
  echo "Starting Gazebo..."
  ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py &
  sleep 10
fi

# Start robot state publisher with robot description
ros2 run robot_state_publisher robot_state_publisher --ros-args -p robot_description:="$ROBOT_DESCRIPTION" &

sleep 2

# Start navigation2 with map
echo "Starting Navigation2 with map $MAP_YAML_PATH..."
ros2 launch nav2_bringup bringup_launch.py use_sim_time:=true map:=$MAP_YAML_PATH &

echo "Navigation started. Kill TMUX session to stop."
wait
`;

    fs.writeFileSync(navScriptPath, navScript);
    fs.chmodSync(navScriptPath, '755');

    // Start in TMUX
    const cmd = `tmux new -s webbot_nav -d "bash ${navScriptPath}"`;
    exec(cmd);

    return c.json({ status: 'started', session: 'webbot_nav', map: mapName });
  } catch (error) {
    return c.json({ error: 'Failed to start navigation', details: String(error) }, 500);
  }
});

// Stop navigation
app.post('/api/navigation/stop-tmux', async (c) => {
  try {
    // Kill TMUX session first (will trigger cleanup trap)
    try {
      exec('tmux kill-session -t webbot_nav 2>/dev/null || true');
    } catch {}

    // Kill nav2 processes
    try { exec('pkill -f nav2_bringup'); } catch {}
    try { exec('pkill -f navigation_launch'); } catch {}
    try { exec('pkill -f robot_state_publisher'); } catch {}
    try { exec('pkill -f turtlebot3_gazebo'); } catch {}
    try { exec('pkill -f "gz sim"'); } catch {}

    return c.json({ status: 'stopped' });
  } catch (error) {
    return c.json({ error: 'Failed to stop navigation', details: String(error) }, 500);
  }
});

// Set initial pose for AMCL localization
app.post('/api/navigation/set-initial-pose', async (c) => {
  try {
    const body = await c.req.json();
    const { x, y, theta } = body;

    if (x === undefined || y === undefined || theta === undefined) {
      return c.json({ error: 'x, y, and theta are required' }, 400);
    }

    // Publish initial pose using ros2 topic pub
    const cmd = [
      'ros2', 'topic', 'pub', '-1', '/initialpose',
      'geometry_msgs/PoseWithCovarianceStamped',
      `{header: {stamp: {sec: 0, nanosec: 0}, frame_id: 'map'}, pose: {pose: {position: {x: ${x}, y: ${y}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: ${Math.sin(theta/2)}, w: ${Math.cos(theta/2)}}}, covariance: [0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0685389192]}`
    ].join(' ');

    exec(cmd);

    return c.json({ status: 'success', x, y, theta });
  } catch (error) {
    return c.json({ error: 'Failed to set initial pose', details: String(error) }, 500);
  }
});

// Get server network info
app.get('/api/network', async (c) => {
  try {
    const { stdout } = await execAsync('hostname -I 2>/dev/null || ip addr show | grep inet | grep -v 127.0.0.1 | head -1');
    const ips = stdout.trim().split(' ').filter(ip => ip.match(/\d+\.\d+\.\d+\.\d+/));

    return c.json({
      ips,
      hostname: require('os').hostname(),
      port: PORT,
    });
  } catch {
    return c.json({ ips: ['localhost'], hostname: 'localhost', port: PORT });
  }
});

// Broadcast presence (for discovery)
app.post('/api/broadcast', async (c) => {
  const body = await c.req.json();
  const port = body.port || PORT;

  // This endpoint can be called by other services to register themselves
  // For now, just acknowledge
  return c.json({ status: 'acknowledged', port });
});

const PORT = process.env.PORT || 4001;

console.log(`Server running on http://0.0.0.0:${PORT}`);

export default {
  port: PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
