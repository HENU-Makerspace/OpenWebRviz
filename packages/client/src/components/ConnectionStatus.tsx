import { Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react';
import type { ConnectionState } from '../hooks/useRosConnection';

interface ConnectionStatusProps {
  connectionState: ConnectionState;
  error: string | null;
  reconnect: () => void;
  reconnectCount: number;
}

export function ConnectionStatus({
  connectionState,
  error,
  reconnect,
  reconnectCount,
}: ConnectionStatusProps) {
  const isConnecting = connectionState === 'connecting';

  const stateConfig = {
    connected: {
      icon: Wifi,
      color: 'text-green-600',
      bg: 'bg-green-50',
      label: 'Connected',
    },
    connecting: {
      icon: RefreshCw,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
      label: 'Connecting...',
    },
    error: {
      icon: AlertCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
      label: 'Error',
    },
    disconnected: {
      icon: WifiOff,
      color: 'text-gray-400',
      bg: 'bg-gray-100',
      label: 'Disconnected',
    },
  };

  const config = stateConfig[connectionState];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bg}`}>
        <Icon
          size={18}
          className={`${config.color} ${isConnecting ? 'animate-spin' : ''}`}
        />
        <span className={`text-sm font-medium ${config.color}`}>
          {config.label}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 max-w-xs">
          <span className="truncate" title={error}>{error}</span>
        </div>
      )}

      {(connectionState === 'disconnected' || connectionState === 'error') && (
        <button
          onClick={reconnect}
          disabled={isConnecting}
          className={`p-1.5 rounded-md transition-colors ${
            isConnecting
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title="Reconnect"
        >
          <RefreshCw size={16} className={isConnecting ? 'animate-spin' : ''} />
        </button>
      )}

      {reconnectCount > 0 && (
        <span className="text-xs text-gray-400">
          {reconnectCount} attempt{reconnectCount > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
