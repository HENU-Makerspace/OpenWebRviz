import { useState, createContext, useContext, useCallback } from 'react';

interface LayerState {
  map: boolean;
  tf: boolean;
  globalPlan: boolean;
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
  const { layers, toggleLayer } = useLayers();

  const layersConfig = [
    { key: 'map' as const, label: '地图', color: 'bg-blue-500' },
    { key: 'tf' as const, label: '机器人 (TF)', color: 'bg-green-500' },
    { key: 'scan' as const, label: '激光雷达', color: 'bg-cyan-500' },
    { key: 'globalPlan' as const, label: '全局路径', color: 'bg-purple-500' },
  ] as const;

  // Data Reception controls are intentionally hidden for the simplified operator UI.
  // const rateOptions = [0, 1, 2, 5, 10, 20, 30];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-700">图层</h2>

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

      {/*
      Data Reception Control is hidden for now.
      <div className="pt-4 border-t">
        ...
      </div>
      */}

      {/*
      Map Topics is hidden for now.
      <div className="pt-4 border-t">
        ...
      </div>
      */}
    </div>
  );
}
