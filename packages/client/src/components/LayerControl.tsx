import { useState, createContext, useContext, useCallback, useEffect } from 'react';
import * as ROSLIB from 'roslib';

interface LayerControlProps {
  ros: ROSLIB.Ros | null;
}

interface LayerState {
  map: boolean;
  laser: boolean;
  tf: boolean;
  globalPlan: boolean;
  localPlan: boolean;
}

interface LayerContextValue {
  layers: LayerState;
  toggleLayer: (layer: keyof LayerState) => void;
  setLayer: (layer: keyof LayerState, value: boolean) => void;
}

const LayerContext = createContext<LayerContextValue | null>(null);

export function useLayers() {
  const context = useContext(LayerContext);
  if (!context) {
    throw new Error('useLayers must be used within LayerControlProvider');
  }
  return context;
}

export function LayerControlProvider({ ros, children }: { ros: ROSLIB.Ros | null; children: React.ReactNode }) {
  const [layers, setLayers] = useState<LayerState>({
    map: true,
    laser: false,
    tf: true,
    globalPlan: false,
    localPlan: false,
  });

  const toggleLayer = useCallback((layer: keyof LayerState) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const setLayer = useCallback((layer: keyof LayerState, value: boolean) => {
    setLayers(prev => ({ ...prev, [layer]: value }));
  }, []);

  return (
    <LayerContext.Provider value={{ layers, toggleLayer, setLayer }}>
      {children}
    </LayerContext.Provider>
  );
}

export function LayerControl({ ros }: LayerControlProps) {
  const { layers, toggleLayer } = useLayers();

  const layersConfig = [
    { key: 'map' as const, label: 'Map', color: 'bg-blue-500', topic: '/map' },
    { key: 'laser' as const, label: 'Laser Scan', color: 'bg-red-500', topic: '/scan' },
    { key: 'tf' as const, label: 'Robot (TF)', color: 'bg-green-500', topic: 'base_link' },
    { key: 'globalPlan' as const, label: 'Global Plan', color: 'bg-purple-500', topic: '/move_base/NavfnROS/plan' },
    { key: 'localPlan' as const, label: 'Local Plan', color: 'bg-yellow-500', topic: '/move_base/TCPlanner/local_plan' },
  ] as const;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-700">Layers</h2>

      <div className="space-y-2">
        {layersConfig.map(({ key, label, color, topic }) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2 flex-1">
              <div className={`w-2 h-2 rounded-full ${color}`}></div>
              <span className="text-sm text-gray-600">{label}</span>
            </div>
          </label>
        ))}
      </div>

      <div className="pt-4 border-t">
        <h3 className="text-sm font-medium text-gray-500 mb-2">Map Topics</h3>
        <div className="space-y-1 text-xs text-gray-400">
          <div className="flex justify-between">
            <span>Occupancy:</span>
            <span className="font-mono">/map</span>
          </div>
          <div className="flex justify-between">
            <span>Laser:</span>
            <span className="font-mono">/scan</span>
          </div>
          <div className="flex justify-between">
            <span>Global Plan:</span>
            <span className="font-mono">/plan</span>
          </div>
        </div>
      </div>
    </div>
  );
}
