import { useState, useEffect } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus';
import { MediaPanel } from './components/MediaPanel';
import { MediaViewport } from './components/MediaViewport';
import { MapCanvas } from './components/MapCanvas';
import { ImageOverlay } from './components/ImageOverlay';
import { LayerControl, LayerControlProvider, useLayers } from './components/LayerControl';
import { DebugPanel } from './hooks/usePerformanceMonitor';
import { useRosConnection } from './hooks/useRosConnection';
import { useRobotMedia } from './hooks/useRobotMedia';
import { useKeyboardTeleop } from './hooks/useKeyboardTeleop';
import { ModeProvider, useMode } from './hooks/useMode';
import { useSlamControl, useMapManager, useNetworkInfo } from './hooks/useSlamControl';
import { useSystemManager } from './hooks/useSystemManager';

interface ServerConfig {
  serverUrl: string;
  jetsonHost: string;
  jetsonRosbridgePort: number;
  rosbridgeUrl: string;
  media: {
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
  };
}

function useServerConfig() {
  const [config, setConfig] = useState<ServerConfig | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  return config;
}

function RosbridgePanel({ wsUrl }: { wsUrl: string }) {
  // Use WebSocket connection status to determine if rosbridge is running
  // (rosbridge runs on Jetson, so we check if we can connect via WebSocket)
  const { isConnected, reconnect, disconnect } = useRosConnection(wsUrl);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-500">Rosbridge</h3>

      {!isConnected ? (
        <button
          onClick={reconnect}
          className="w-full px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600"
        >
          Connect to Robot
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Connected to Robot
          </div>
          <button
            onClick={disconnect}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function MappingPanel({ wsUrl }: { wsUrl: string }) {
  const { ros, isConnected } = useRosConnection(wsUrl);
  const { status: robotStatus, startSlam, stopAll, saveMap } = useSystemManager(ros, isConnected);
  const { maps, fetchMaps, loading: mapsLoading } = useMapManager();
  const { slamRunning, slamRunningInitialized, loading: slamLoading, usingTmux } = useSlamControl();
  const [saving, setSaving] = useState(false);

  const isRobotMode = robotStatus.mode === 'slam';
  const isRunning = isRobotMode || slamRunning;

  const handleStartSlam = async () => {
    await startSlam();
  };

  const handleStopSlam = async () => {
    await stopAll();
  };

  const handleSaveMap = async () => {
    setSaving(true);
    console.log('[SaveMap] Starting save on robot...');
    // Save on robot (Jetson will upload to server automatically)
    const result = await saveMap();
    console.log('[SaveMap] Robot save result:', result);
    // Wait for upload and refresh maps
    console.log('[SaveMap] Waiting for upload...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('[SaveMap] Refreshing maps from server...');
    await fetchMaps();
    console.log('[SaveMap] Done, maps:', maps);
    setSaving(false);
  };

  // Show loading while checking status
  if (!slamRunningInitialized && !robotStatus.mode) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-500">SLAM</h3>
        <div className="text-xs text-gray-400">Checking status...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-500">SLAM</h3>

      {!isRunning ? (
        <div className="space-y-2">
          <button
            onClick={handleStartSlam}
            disabled={robotStatus.loading || slamLoading}
            className="w-full px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
          >
            {robotStatus.loading || slamLoading ? 'Starting...' : 'Start SLAM'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            SLAM Running {isRobotMode ? '(Robot)' : usingTmux ? '(TMUX)' : ''}
          </div>
          <button
            onClick={handleSaveMap}
            disabled={saving}
            className="w-full px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Map'}
          </button>
          <button
            onClick={handleStopSlam}
            disabled={robotStatus.loading || slamLoading}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {robotStatus.loading || slamLoading ? 'Stopping...' : 'Stop SLAM'}
          </button>
        </div>
      )}

      {maps.length > 0 && (
        <div className="pt-2 border-t">
          <h4 className="text-xs font-medium text-gray-500 mb-2">Saved Maps</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {maps.map((map) => (
              <div
                key={map.name}
                className="flex items-center justify-between text-xs bg-gray-50 px-2 py-1 rounded"
              >
                <span>{map.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface NavigationPanelProps {
  navClickMode: 'none' | 'initial_pose' | 'goal';
  setNavClickMode: (mode: 'none' | 'initial_pose' | 'goal') => void;
  selectedMap: string | null;
  setSelectedMap: (map: string | null) => void;
}

type Stance = 'stand' | 'crouch';
type Speed = 'high' | 'medium' | 'low';

function NavigationPanel({ navClickMode, setNavClickMode, selectedMap, setSelectedMap, wsUrl }: NavigationPanelProps & { wsUrl: string }) {
  const { maps, fetchMaps, loading } = useMapManager();
  const [starting, setStarting] = useState(false);
  const [stance, setStance] = useState<Stance>('crouch');
  const [speed, setSpeed] = useState<Speed>('high');

  // Use system manager for robot control
  const { ros, isConnected } = useRosConnection(wsUrl);
  const { status: robotStatus, startNavigation: startNav, stopAll } = useSystemManager(ros, isConnected);

  const isNavRunning = robotStatus.mode === 'navigation';

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  const startNavigation = async () => {
    console.log('[StartNav] clicked, selectedMap:', selectedMap, 'stance:', stance, 'speed:', speed, 'isNavRunning:', isNavRunning);
    if (!selectedMap) {
      console.log('[StartNav] no map selected, returning');
      return;
    }
    setStarting(true);
    // 传递 Jetson 上的地图路径, 姿态和速度
    const mapYamlPath = `/home/nvidia/maps/${selectedMap}.yaml`;
    console.log('[StartNav] calling startNav with:', mapYamlPath, 'stance:', stance, 'speed:', speed);
    await startNav(mapYamlPath, stance, speed);
    setStarting(false);
  };

  const stopNavigation = async () => {
    await stopAll();
  };

  if (loading) {
    return <div className="text-xs text-gray-500">Scanning for maps...</div>;
  }

  if (maps.length === 0) {
    return (
      <div className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded">
        No maps found. Please use Teleop mode to create a map first.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500">Select Map</h4>
      <select
        value={selectedMap || ''}
        onChange={(e) => setSelectedMap(e.target.value || null)}
        className="w-full px-2 py-1 text-xs border rounded"
        disabled={isNavRunning}
      >
        <option value="">-- Select Map --</option>
        {maps.map((map) => (
          <option key={map.name} value={map.name}>
            {map.name}
          </option>
        ))}
      </select>

      {/* Stance selection - disabled during navigation */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-gray-500">Stance</h4>
        <div className="flex gap-2">
          <button
            onClick={() => setStance('crouch')}
            disabled={isNavRunning}
            className={`flex-1 text-xs py-1 px-2 rounded border ${
              stance === 'crouch'
                ? 'bg-blue-100 border-blue-500 text-blue-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            Crouch
          </button>
          <button
            onClick={() => setStance('stand')}
            disabled={isNavRunning}
            className={`flex-1 text-xs py-1 px-2 rounded border ${
              stance === 'stand'
                ? 'bg-blue-100 border-blue-500 text-blue-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            Stand
          </button>
        </div>
      </div>

      {/* Speed selection - disabled during navigation */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-gray-500">Speed</h4>
        <div className="flex gap-1">
          <button
            onClick={() => setSpeed('high')}
            disabled={isNavRunning}
            className={`flex-1 text-xs py-1 px-2 rounded border ${
              speed === 'high'
                ? 'bg-blue-100 border-blue-500 text-blue-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            High
          </button>
          <button
            onClick={() => setSpeed('medium')}
            disabled={isNavRunning}
            className={`flex-1 text-xs py-1 px-2 rounded border ${
              speed === 'medium'
                ? 'bg-blue-100 border-blue-500 text-blue-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            Medium
          </button>
          <button
            onClick={() => setSpeed('low')}
            disabled={isNavRunning}
            className={`flex-1 text-xs py-1 px-2 rounded border ${
              speed === 'low'
                ? 'bg-blue-100 border-blue-500 text-blue-700'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            Low
          </button>
        </div>
      </div>

      {selectedMap && !isNavRunning && (
        <button
          onClick={startNavigation}
          disabled={starting}
          className="w-full bg-purple-600 text-white text-xs py-1 px-2 rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {starting ? 'Starting...' : `Start Nav (${stance === 'stand' ? 'Stand' : 'Crouch'}, ${speed})`}
        </button>
      )}

      {isNavRunning && (
        <div className="space-y-2">
          <div className="text-xs text-green-600">Navigation Running</div>

          <div className="text-xs text-gray-500">Click Mode</div>
          <div className="flex gap-1">
            <button
              onClick={() => setNavClickMode(navClickMode === 'initial_pose' ? 'none' : 'initial_pose')}
              className={`flex-1 text-xs py-1 px-2 rounded ${
                navClickMode === 'initial_pose'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Set Initial Pose
            </button>
            <button
              onClick={() => setNavClickMode(navClickMode === 'goal' ? 'none' : 'goal')}
              className={`flex-1 text-xs py-1 px-2 rounded ${
                navClickMode === 'goal'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Set Goal
            </button>
          </div>

          <button
            onClick={stopNavigation}
            className="w-full bg-red-500 text-white text-xs py-1 px-2 rounded hover:bg-red-600"
          >
            Stop Navigation
          </button>
        </div>
      )}
    </div>
  );
}

function NetworkPanel() {
  const networkInfo = useNetworkInfo();

  if (!networkInfo) return null;

  return (
    <div className="pt-4 border-t text-xs text-gray-500">
      <div className="font-medium mb-1">Network:</div>
      {networkInfo.ips.map((ip) => (
        <div key={ip} className="font-mono">
          {ip}:{networkInfo.port}
        </div>
      ))}
    </div>
  );
}

function AppContent() {
  const [showDebug, setShowDebug] = useState(false);
  const config = useServerConfig();
  const media = useRobotMedia(config?.media || null);
  const wsUrl = config?.rosbridgeUrl || '';
  const { ros, isConnected } = useRosConnection(wsUrl);
  const { subscriptionSettings } = useLayers();
  const { mode, setMode } = useMode();
  const [navClickMode, setNavClickMode] = useState<'none' | 'initial_pose' | 'goal'>('none');
  const [selectedMap, setSelectedMap] = useState<string | null>(null);

  // System manager for robot control
  const { status: robotStatus, startSlam, stopAll, saveMap } = useSystemManager(ros, isConnected);
  const { maps, fetchMaps } = useMapManager();

  useKeyboardTeleop(ros, {
    linearSpeed: 0.5,
    angularSpeed: 1.0,
    cmdVelTopic: '/cmd_vel',
  }, isConnected && mode === 'teleop');

  // Handle save map - save on robot (Jetson will upload to server automatically)
  const handleSaveMap = async () => {
    if (!isConnected) return;
    await saveMap();
    // Wait for upload and refresh maps
    await new Promise(resolve => setTimeout(resolve, 3000));
    fetchMaps();
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-800">WebBot-Viz</h1>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Mode:</span>
            <button
              onClick={() => setMode('teleop')}
              className={`px-3 py-1 text-xs rounded ${
                mode === 'teleop'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Teleop
            </button>
            <button
              onClick={() => setMode('navigation')}
              className={`px-3 py-1 text-xs rounded ${
                mode === 'navigation'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Navigation
            </button>
          </div>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {showDebug ? 'Hide Debug' : 'Show Debug'}
          </button>
        </div>
        <ConnectionStatus wsUrl={wsUrl} />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 bg-white border-r p-4 overflow-y-auto space-y-6">
          <RosbridgePanel wsUrl={wsUrl} />
          {mode === 'teleop' ? (
            <MappingPanel wsUrl={wsUrl} />
          ) : (
            <NavigationPanel
              navClickMode={navClickMode}
              setNavClickMode={setNavClickMode}
              selectedMap={selectedMap}
              setSelectedMap={setSelectedMap}
              wsUrl={wsUrl}
            />
          )}
          {config?.media && <MediaPanel media={media} />}
          <LayerControl />
          <NetworkPanel />
        </aside>

        <main className="flex-1 relative">
          {showDebug && <DebugPanel />}
          <MapCanvas
            ros={ros}
            isConnected={isConnected}
            navClickMode={navClickMode}
            setNavClickMode={setNavClickMode}
            selectedMap={selectedMap}
          />
          <MediaViewport
            videoRef={media.videoRef}
            videoConnected={media.videoConnected}
            audioMonitoring={media.audioConnected}
            talkbackActive={media.talkbackActive}
            onCloseVideo={media.stopVideo}
          />
          <ImageOverlay ros={ros} hidden={media.videoConnected} />
        </main>
      </div>

      {isConnected && mode === 'teleop' && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm">
          <span className="font-mono">W/A/S/D</span> or <span className="font-mono">Arrow Keys</span> to move
        </div>
      )}

      {isConnected && mode === 'navigation' && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm">
          Click on the map to set a navigation goal
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <LayerControlProvider>
      <ModeProvider>
        <AppContent />
      </ModeProvider>
    </LayerControlProvider>
  );
}

export default App;
