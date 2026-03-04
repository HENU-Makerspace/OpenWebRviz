import { useState } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus';
import { MapCanvas } from './components/MapCanvas';
import { LayerControl, LayerControlProvider } from './components/LayerControl';
import { DebugPanel } from './hooks/usePerformanceMonitor';
import { useRosConnection } from './hooks/useRosConnection';

function App() {
  const [showDebug, setShowDebug] = useState(false);
  const { ros, isConnected } = useRosConnection('ws://localhost:9090');

  return (
    <LayerControlProvider>
      <div className="h-screen flex flex-col bg-gray-100">
        {/* Header */}
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-800">WebBot-Viz</h1>
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {showDebug ? 'Hide Debug' : 'Show Debug'}
            </button>
          </div>
          <ConnectionStatus wsUrl="ws://localhost:9090" />
        </header>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 bg-white border-r p-4 overflow-y-auto">
            <LayerControl ros={ros} />
          </aside>

          {/* Map Canvas */}
          <main className="flex-1 relative">
            {showDebug && <DebugPanel />}
            <MapCanvas ros={ros} isConnected={isConnected} />
          </main>
        </div>
      </div>
    </LayerControlProvider>
  );
}

export default App;
