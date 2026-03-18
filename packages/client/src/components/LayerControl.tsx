import { useState, createContext, useContext, useCallback } from 'react';

interface LayerState {
  map: boolean;
  tf: boolean;
  globalPlan: boolean;
  localPlan: boolean;
  image: boolean;
  scan: boolean;
}

interface SubscriptionSettings {
  rate: number;
  paused: boolean;
}

interface LayerContextValue {
  layers: LayerState;
  toggleLayer: (layer: keyof LayerState) => void;
  setLayer: (layer: keyof LayerState, value: boolean) => void;
  subscriptionSettings: SubscriptionSettings;
  setSubscriptionRate: (rate: number) => void;
  toggleSubscriptionPause: () => void;
  setSubscriptionPaused: (paused: boolean) => void;
}

const LayerContext = createContext<LayerContextValue | null>(null);

export function useLayers() {
  const context = useContext(LayerContext);
  if (!context) {
    throw new Error('useLayers must be used within LayerControlProvider');
  }
  return context;
}

export function LayerControlProvider({ children }: { children: React.ReactNode }) {
  const [layers, setLayers] = useState<LayerState>({
    map: true,
    tf: true,
    globalPlan: true,
    localPlan: false,
    image: false,
    scan: false,
  });

  const [subscriptionSettings, setSubscriptionSettings] = useState<SubscriptionSettings>({
    rate: 0, // Default unlimited
    paused: false,
  });

  const toggleLayer = useCallback((layer: keyof LayerState) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const setLayer = useCallback((layer: keyof LayerState, value: boolean) => {
    setLayers(prev => ({ ...prev, [layer]: value }));
  }, []);

  const setSubscriptionRate = useCallback((rate: number) => {
    setSubscriptionSettings(prev => ({ ...prev, rate: Math.max(0, rate) }));
  }, []);

  const toggleSubscriptionPause = useCallback(() => {
    setSubscriptionSettings(prev => ({ ...prev, paused: !prev.paused }));
  }, []);

  const setSubscriptionPaused = useCallback((paused: boolean) => {
    setSubscriptionSettings(prev => ({ ...prev, paused }));
  }, []);

  return (
    <LayerContext.Provider
      value={{
        layers,
        toggleLayer,
        setLayer,
        subscriptionSettings,
        setSubscriptionRate,
        toggleSubscriptionPause,
        setSubscriptionPaused,
      }}
    >
      {children}
    </LayerContext.Provider>
  );
}

export function LayerControl() {
  const { layers, toggleLayer, subscriptionSettings, setSubscriptionRate, toggleSubscriptionPause } = useLayers();

  const layersConfig = [
    { key: 'map' as const, label: 'Map', color: 'bg-blue-500' },
    { key: 'tf' as const, label: 'Robot (TF)', color: 'bg-green-500' },
    { key: 'scan' as const, label: 'Laser Scan', color: 'bg-cyan-500' },
    { key: 'globalPlan' as const, label: 'Global Plan', color: 'bg-purple-500' },
    { key: 'localPlan' as const, label: 'Local Plan', color: 'bg-yellow-500' },
    { key: 'image' as const, label: 'Camera Image', color: 'bg-pink-500' },
  ] as const;

  const rateOptions = [0, 1, 2, 5, 10, 20, 30];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-700">Layers</h2>

      <div className="space-y-2">
        {layersConfig.map(({ key, label, color }) => (
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

      {/* Data Reception Control */}
      <div className="pt-4 border-t">
        <h3 className="text-sm font-medium text-gray-500 mb-2">Data Reception</h3>

        {/* Pause/Resume */}
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={subscriptionSettings.paused}
            onChange={toggleSubscriptionPause}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">Pause data reception</span>
        </label>

        {/* Rate Control */}
        <div className="space-y-2">
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Rate (Hz):</span>
            <select
              value={subscriptionSettings.rate}
              onChange={(e) => setSubscriptionRate(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              {rateOptions.map(rate => (
                <option key={rate} value={rate}>
                  {rate === 0 ? 'Unlimited' : `${rate} Hz`}
                </option>
              ))}
            </select>
          </label>
        </div>
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
