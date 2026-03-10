import { useState, useEffect } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus';
import { MapCanvas } from './components/MapCanvas';
import { ImageOverlay } from './components/ImageOverlay';
import { LayerControl, LayerControlProvider, useLayers } from './components/LayerControl';
import { DebugPanel } from './hooks/usePerformanceMonitor';
import { useRosConnection } from './hooks/useRosConnection';
import { useKeyboardTeleop } from './hooks/useKeyboardTeleop';
import { ModeProvider, useMode } from './hooks/useMode';
import { useSlamControl, useRosbridgeControl, useMapManager, useNetworkInfo } from './hooks/useSlamControl';

function RosbridgePanel() {
  const { rosbridgeRunning, rosbridgeInitialized, loading, startRosbridge, stopRosbridge } = useRosbridgeControl();

  if (!rosbridgeInitialized) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-500">Rosbridge</h3>
        <div className="text-xs text-gray-400">Checking status...</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-500">Rosbridge</h3>

      {!rosbridgeRunning ? (
        <button
          onClick={startRosbridge}
          disabled={loading}
          className="w-full px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Rosbridge'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Rosbridge Running
          </div>
          <button
            onClick={stopRosbridge}
            disabled={loading}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? 'Stopping...' : 'Stop Rosbridge'}
          </button>
        </div>
      )}
    </div>
  );
}

function MappingPanel() {
  const { slamRunning, slamRunningInitialized, loading: slamLoading, startSlam, startWithTmux, stopSlam, usingTmux } = useSlamControl();
  const { maps, loading: mapsLoading, saveMap, fetchMaps } = useMapManager();
  const [saving, setSaving] = useState(false);

  const handleStartSlam = async () => {
    await startSlam();
  };

  const handleStartWithTmux = async () => {
    await startWithTmux();
  };

  const handleStopSlam = async () => {
    await stopSlam();
  };

  const handleSaveMap = async () => {
    setSaving(true);
    const mapName = `map_${Date.now()}`;
    await saveMap(mapName);
    setSaving(false);
  };

  // Show loading while checking status
  if (!slamRunningInitialized) {
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

      {!slamRunning ? (
        <div className="space-y-2">
          <button
            onClick={handleStartSlam}
            disabled={slamLoading}
            className="w-full px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
          >
            {slamLoading ? 'Starting...' : 'Start SLAM'}
          </button>
          <button
            onClick={handleStartWithTmux}
            disabled={slamLoading}
            className="w-full px-3 py-2 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
          >
            {slamLoading ? 'Starting...' : 'Run Robot Script (TMUX)'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            SLAM Running {usingTmux && '(TMUX)'}
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
            disabled={slamLoading}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {slamLoading ? 'Stopping...' : 'Stop SLAM'}
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
}

function NavigationPanel({ navClickMode, setNavClickMode }: NavigationPanelProps) {
  const { maps, fetchMaps, loading } = useMapManager();
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [navStatus, setNavStatus] = useState<{ running: boolean; tmux: boolean }>({ running: false, tmux: false });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  // Poll navigation status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('http://localhost:4000/api/navigation/status');
        const data = await res.json();
        setNavStatus(data);
      } catch {}
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const startNavigation = async () => {
    if (!selectedMap) return;
    setStarting(true);
    try {
      await fetch('http://localhost:4000/api/navigation/start-tmux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapName: selectedMap }),
      });
    } finally {
      setStarting(false);
    }
  };

  const stopNavigation = async () => {
    await fetch('http://localhost:4000/api/navigation/stop-tmux', { method: 'POST' });
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
        disabled={navStatus.running}
      >
        <option value="">-- Select Map --</option>
        {maps.map((map) => (
          <option key={map.name} value={map.name}>
            {map.name}
          </option>
        ))}
      </select>

      {selectedMap && !navStatus.running && (
        <button
          onClick={startNavigation}
          disabled={starting}
          className="w-full bg-purple-600 text-white text-xs py-1 px-2 rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {starting ? 'Starting...' : 'Start Navigation'}
        </button>
      )}

      {navStatus.running && (
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
  const { ros, isConnected } = useRosConnection('ws://192.168.1.58:9090');
  const { subscriptionSettings } = useLayers();
  const { mode, setMode } = useMode();
  const [navClickMode, setNavClickMode] = useState<'none' | 'initial_pose' | 'goal'>('none');

  useKeyboardTeleop(ros, {
    linearSpeed: 0.5,
    angularSpeed: 1.0,
    cmdVelTopic: '/cmd_vel',
  }, isConnected && mode === 'teleop');

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
        <ConnectionStatus wsUrl="ws://192.168.1.58:9090" />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 bg-white border-r p-4 overflow-y-auto space-y-6">
          <RosbridgePanel />
          {mode === 'teleop' ? (
            <MappingPanel />
          ) : (
            <NavigationPanel navClickMode={navClickMode} setNavClickMode={setNavClickMode} />
          )}
          <LayerControl />
          <NetworkPanel />
        </aside>

        <main className="flex-1 relative">
          {showDebug && <DebugPanel />}
          <MapCanvas ros={ros} isConnected={isConnected} navClickMode={navClickMode} setNavClickMode={setNavClickMode} />
          <ImageOverlay ros={ros} />
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
