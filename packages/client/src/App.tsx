import { useState, useEffect, useRef, type PointerEvent } from 'react';
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Gamepad2,
  Info,
  Layers,
  LocateFixed,
  MapPinned,
  Maximize2,
  Mic,
  Radio,
  Route,
  Settings,
  ShieldCheck,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MediaViewport } from './components/MediaViewport';
import { MapCanvas } from './components/MapCanvas';
import { LayerControl, LayerControlProvider, useLayers } from './components/LayerControl';
import { RobotSettingsPanel } from './components/RobotSettingsPanel';
import { DebugPanel } from './hooks/usePerformanceMonitor';
import { useRosConnection } from './hooks/useRosConnection';
import { useRobotMedia } from './hooks/useRobotMedia';
import { useKeyboardTeleop } from './hooks/useKeyboardTeleop';
import { ModeProvider, useMode } from './hooks/useMode';
import { useSlamControl, useMapManager } from './hooks/useSlamControl';
import { useFaceRecognition } from './hooks/useFaceRecognition';
import { useNavigationTasks } from './hooks/useNavigationTasks';
import { useSystemManager } from './hooks/useSystemManager';
import type { NavigationPose, NavigationTaskMode, NavigationTaskStatus } from './hooks/useNavigationTasks';
import backgroundImage from '../../../img/background.png';
import borderImage from '../../../img/border.png';
import robotImage from '../../../img/bg1.png';
import robotWireImage from '../../../img/bg2.png';
import logoImage from '../../../img/icon.png';

interface ServerConfig {
  serverUrl: string;
  profile?: string;
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
  face: {
    enabled: boolean;
    latestUrl: string;
    healthUrl: string;
    pollIntervalMs: number;
  };
  topics?: {
    cmdVelTopic?: string;
    motionCmdTopic?: string;
    standCmdTopic?: string;
  };
  teleop?: {
    standMode?: boolean;
    up?: number;
    publishRateHz?: number;
  };
  navigation?: {
    navigateToPoseAction?: string;
    navigateToPoseType?: string;
    navigateThroughPosesAction?: string;
    navigateThroughPosesType?: string;
    frameId?: string;
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

function TechPanel({
  title,
  children,
  className = '',
  action,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`tech-panel-frame relative overflow-hidden rounded-lg border border-cyan-300/55 bg-cyan-950/38 shadow-[0_0_22px_rgba(14,165,233,0.16)] backdrop-blur-[3px] ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(6,182,212,0.14),rgba(8,47,73,0.18)_42%,rgba(59,130,246,0.10))]" />
      <div className="pointer-events-none absolute left-0 top-4 h-6 w-0.5 bg-cyan-300" />
      {(title || action) && (
        <div className="relative flex items-center justify-between border-b border-cyan-400/15 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
          {action}
        </div>
      )}
      <div className="relative p-4">{children}</div>
    </section>
  );
}

function TopModeButton({
  active,
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`header-mode-button group ${active ? 'is-active' : ''}`}
    >
      <Icon className={`h-4 w-4 ${active ? 'text-cyan-300' : 'text-slate-500 group-hover:text-cyan-300'}`} />
      <span>
        <span className="block text-sm font-semibold leading-5">{title}</span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">{subtitle}</span>
      </span>
    </button>
  );
}

function MetricBar({ label, value, color }: { label: string; value: string; color: string }) {
  const numericValue = Math.max(0, Math.min(100, Number.parseFloat(value) || 0));

  return (
    <div className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2 text-xs text-slate-200">
      <span>{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-700/55">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${numericValue}%` }} />
      </div>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}

function MapToolButton({ icon: Icon, active = false }: { icon: React.ComponentType<{ className?: string }>; active?: boolean }) {
  return (
    <button
      type="button"
      className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
        active
          ? 'border-violet-300/70 bg-violet-500/30 text-white shadow-[0_0_16px_rgba(168,85,247,0.28)]'
          : 'border-cyan-300/38 bg-slate-950/44 text-cyan-100 hover:bg-cyan-500/14'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function RosbridgePanel({
  isConnected,
  reconnect,
  disconnect,
  profile,
  rosbridgeUrl,
}: {
  isConnected: boolean;
  reconnect: () => void;
  disconnect: () => void;
  profile?: string;
  rosbridgeUrl?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-500">Rosbridge</h3>
      <div className="space-y-1 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">
        <div>连接模式：{profile || 'unknown'}</div>
        <div className="truncate font-mono" title={rosbridgeUrl || ''}>
          {rosbridgeUrl || '未配置'}
        </div>
      </div>

      {!isConnected ? (
        <button
          onClick={reconnect}
          className="w-full px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600"
        >
          连接机器人
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            已连接机器人
          </div>
          <button
            onClick={disconnect}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            断开连接
          </button>
        </div>
      )}
    </div>
  );
}

function MappingPanel({ ros, isConnected }: { ros: any; isConnected: boolean }) {
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
        <div className="text-xs text-gray-400">正在检查状态...</div>
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
            {robotStatus.loading || slamLoading ? '启动中...' : '启动 SLAM'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            SLAM 运行中 {isRobotMode ? '(机器人)' : usingTmux ? '(TMUX)' : ''}
          </div>
          <button
            onClick={handleSaveMap}
            disabled={saving}
            className="w-full px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存地图'}
          </button>
          <button
            onClick={handleStopSlam}
            disabled={robotStatus.loading || slamLoading}
            className="w-full px-3 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {robotStatus.loading || slamLoading ? '停止中...' : '停止 SLAM'}
          </button>
        </div>
      )}

      {maps.length > 0 && (
        <div className="pt-2 border-t">
          <h4 className="text-xs font-medium text-gray-500 mb-2">已保存地图</h4>
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

type NavClickMode = 'none' | 'initial_pose' | 'goal' | 'waypoint';
type MainViewport = 'map' | 'camera';

interface NavigationPanelProps {
  navClickMode: NavClickMode;
  setNavClickMode: (mode: NavClickMode) => void;
  selectedMap: string | null;
  setSelectedMap: (map: string | null) => void;
  taskMode: NavigationTaskMode;
  setTaskMode: (mode: NavigationTaskMode) => void;
  patrolPoints: NavigationPose[];
  onRemovePatrolPoint: (id: string) => void;
  onClearPatrolPoints: () => void;
  onStartPatrolTask: () => Promise<void>;
  onCancelTask: () => void;
  taskStatus: NavigationTaskStatus;
  taskRunning: boolean;
}

type Stance = 'stand' | 'crouch';
type Speed = 'high' | 'medium' | 'low';

function NavigationPanel({
  navClickMode,
  setNavClickMode,
  selectedMap,
  setSelectedMap,
  taskMode,
  setTaskMode,
  patrolPoints,
  onRemovePatrolPoint,
  onClearPatrolPoints,
  onStartPatrolTask,
  onCancelTask,
  taskStatus,
  taskRunning,
  ros,
  isConnected,
}: NavigationPanelProps & { ros: any; isConnected: boolean }) {
  const { maps, fetchMaps, loading } = useMapManager();
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stance, setStance] = useState<Stance>('crouch');
  const [speed, setSpeed] = useState<Speed>('high');

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
    try {
      await startNav(mapYamlPath, stance, speed);
    } finally {
      setStarting(false);
    }
  };

  const stopNavigation = async () => {
    if (stopping) {
      return;
    }

    setStopping(true);
    onCancelTask();
    try {
      await stopAll();
    } finally {
      setStopping(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-gray-500">正在扫描地图...</div>;
  }

  if (maps.length === 0) {
    return (
      <div className="rounded border border-red-400/40 bg-red-500/12 p-2 text-xs text-red-300">
        没有找到地图，请先在 Teleop 模式下建图。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500">选择地图</h4>
      <select
        value={selectedMap || ''}
        onChange={(e) => setSelectedMap(e.target.value || null)}
        className="w-full px-2 py-1 text-xs border rounded"
        disabled={isNavRunning}
      >
        <option value="">-- 请选择地图 --</option>
        {maps.map((map) => (
          <option key={map.name} value={map.name}>
            {map.name}
          </option>
        ))}
      </select>

      {robotStatus.error && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600">
          {robotStatus.error}
        </div>
      )}

      {/* Stance selection - disabled during navigation */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-gray-500">姿态</h4>
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
            蹲姿
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
            站立
          </button>
        </div>
      </div>

      {/* Speed selection - disabled during navigation */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-gray-500">速度</h4>
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
            高
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
            中
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
            低
          </button>
        </div>
      </div>

      {selectedMap && !isNavRunning && (
        <button
          onClick={startNavigation}
          disabled={starting || stopping}
          className="w-full bg-purple-600 text-white text-xs py-1 px-2 rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {starting ? '启动中...' : `启动导航（${stance === 'stand' ? '站立' : '蹲姿'}，${speed === 'high' ? '高速' : speed === 'medium' ? '中速' : '低速'}）`}
        </button>
      )}

      {isNavRunning && (
        <div className="space-y-2">
          <div className="text-xs text-green-600">导航运行中</div>

          <div className="space-y-1">
            <div className="text-xs text-gray-500">任务模式</div>
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => {
                  setTaskMode('single');
                  setNavClickMode('none');
                }}
                className={`rounded px-2 py-1 text-xs ${
                  taskMode === 'single'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                单点
              </button>
              <button
                onClick={() => {
                  setTaskMode('route');
                  setNavClickMode('none');
                }}
                className={`rounded px-2 py-1 text-xs ${
                  taskMode === 'route'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                途经多点
              </button>
              <button
                onClick={() => {
                  setTaskMode('loop');
                  setNavClickMode('none');
                }}
                className={`rounded px-2 py-1 text-xs ${
                  taskMode === 'loop'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                循环巡航
              </button>
            </div>
          </div>

          <div className="rounded border bg-gray-50 p-2 text-xs text-gray-600">
            <div>当前任务：{taskMode === 'single' ? '单点导航' : taskMode === 'route' ? '途经多点' : '循环巡航'}</div>
            <div>执行状态：{
              taskStatus.state === 'idle'
                ? '空闲'
                : taskStatus.state === 'running'
                  ? `执行中（第 ${taskStatus.iteration} 轮）`
                  : taskStatus.state === 'succeeded'
                    ? '已完成'
                    : taskStatus.state === 'canceled'
                      ? '已取消'
                      : '失败'
            }</div>
            {taskStatus.totalWaypoints > 1 && (
              <div>当前点位：{Math.min(taskStatus.waypointIndex, taskStatus.totalWaypoints)} / {taskStatus.totalWaypoints}</div>
            )}
            {taskStatus.error && <div className="mt-1 text-red-500">{taskStatus.error}</div>}
          </div>

          <div className="text-xs text-gray-500">点击模式</div>
          <div className="flex gap-1">
            <button
              onClick={() => setNavClickMode(navClickMode === 'initial_pose' ? 'none' : 'initial_pose')}
              className={`flex-1 text-xs py-1 px-2 rounded ${
                navClickMode === 'initial_pose'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              设置初始位姿
            </button>
            {taskMode === 'single' ? (
              <button
                onClick={() => setNavClickMode(navClickMode === 'goal' ? 'none' : 'goal')}
                className={`flex-1 text-xs py-1 px-2 rounded ${
                  navClickMode === 'goal'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                设置目标点
              </button>
            ) : (
              <button
                onClick={() => setNavClickMode(navClickMode === 'waypoint' ? 'none' : 'waypoint')}
                className={`flex-1 text-xs py-1 px-2 rounded ${
                  navClickMode === 'waypoint'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                添加途经点
              </button>
            )}
          </div>

          {taskMode !== 'single' && (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-600">点位列表</div>
                <button
                  onClick={onClearPatrolPoints}
                  disabled={patrolPoints.length === 0}
                  className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                >
                  清空
                </button>
              </div>
              {patrolPoints.length === 0 ? (
                <div className="text-xs text-slate-500">
                  在地图上依次添加点位，系统会按添加顺序执行。
                </div>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {patrolPoints.map((point, index) => (
                    <div
                      key={point.id}
                      className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <div>
                        <div>点 {index + 1}</div>
                        <div className="text-slate-500">
                          {point.x.toFixed(2)}, {point.y.toFixed(2)}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemovePatrolPoint(point.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => void onStartPatrolTask()}
                disabled={patrolPoints.length < 2 || taskRunning || stopping}
                className="w-full rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {taskRunning
                  ? '任务执行中...'
                  : taskMode === 'route'
                    ? '开始途经多点'
                    : '开始循环巡航'}
              </button>
            </div>
          )}

          {taskRunning && (
            <button
              onClick={onCancelTask}
              disabled={stopping}
              className="w-full bg-amber-500 text-white text-xs py-1 px-2 rounded hover:bg-amber-600 disabled:opacity-50"
            >
              停止当前任务
            </button>
          )}

          <button
            onClick={() => void stopNavigation()}
            disabled={stopping || robotStatus.loading}
            className="w-full bg-red-500 text-white text-xs py-1 px-2 rounded hover:bg-red-600 disabled:opacity-50"
          >
            {stopping || robotStatus.loading ? '停止导航中...' : '停止导航'}
          </button>
        </div>
      )}
    </div>
  );
}

// NetworkPanel is intentionally hidden for the simplified operator UI.
// function NetworkPanel() {
//   const networkInfo = useNetworkInfo();
//
//   if (!networkInfo) return null;
//
//   return (
//     <div className="pt-4 border-t text-xs text-gray-500">
//       <div className="font-medium mb-1">Network:</div>
//       {networkInfo.ips.map((ip) => (
//         <div key={ip} className="font-mono">
//           {ip}:{networkInfo.port}
//         </div>
//       ))}
//     </div>
//   );
// }

function AppContent() {
  const [showDebug, setShowDebug] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'navigation' | 'teleop' | 'broadcast'>('teleop');
  const [mainViewport, setMainViewport] = useState<MainViewport>('map');
  const config = useServerConfig();
  const media = useRobotMedia(config?.media || null);
  const face = useFaceRecognition(config?.face || null, media.videoConnected);
  const wsUrl = config?.rosbridgeUrl || '';
  const {
    ros,
    isConnected,
    connectionState,
    error: rosError,
    reconnect,
    disconnect,
    reconnectCount,
  } = useRosConnection(wsUrl);
  const { subscriptionSettings } = useLayers();
  const { mode, setMode } = useMode();
  const [navClickMode, setNavClickMode] = useState<NavClickMode>('none');
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const previousSelectedMapRef = useRef<string | null>(selectedMap);
  const [mapSelectionResetToken, setMapSelectionResetToken] = useState(0);
  const [navigationTaskMode, setNavigationTaskMode] = useState<NavigationTaskMode>('single');
  const [patrolPoints, setPatrolPoints] = useState<NavigationPose[]>([]);
  const navigationTasks = useNavigationTasks(ros, isConnected, config?.navigation || null);

  const teleop = useKeyboardTeleop(ros, {
    linearSpeed: 0.5,
    angularSpeed: 1.0,
    motionCmdTopic: config?.topics?.motionCmdTopic || '/diablo/MotionCmd',
    standCmdTopic: config?.topics?.standCmdTopic || '/stand_cmd',
    standMode: config?.teleop?.standMode ?? false,
    up: config?.teleop?.up ?? 0.0,
    publishRateHz: config?.teleop?.publishRateHz ?? 25,
  }, isConnected && mode === 'teleop');

  const teleopControlsEnabled = isConnected && mode === 'teleop';
  const motionButtonClass = `motion-pad-button ${teleopControlsEnabled ? '' : 'opacity-45 cursor-not-allowed'}`;

  const startMotionButton = (linear: number, angular: number) => {
    if (!teleopControlsEnabled) return;
    teleop.startManualCommand(linear, angular);
  };

  const stopMotionButton = () => {
    teleop.stopManualCommand();
  };

  const handleMotionPointerDown = (event: PointerEvent<HTMLButtonElement>, linear: number, angular: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startMotionButton(linear, angular);
  };

  const handleMotionPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopMotionButton();
  };

  useEffect(() => {
    if (previousSelectedMapRef.current === selectedMap) {
      return;
    }

    previousSelectedMapRef.current = selectedMap;
    setPatrolPoints([]);
    setNavClickMode('none');
    setMapSelectionResetToken((value) => value + 1);
    navigationTasks.cancelCurrentTask();
  }, [navigationTasks.cancelCurrentTask, selectedMap]);

  const addPatrolPoint = (pose: NavigationPose) => {
    setPatrolPoints((prev) => [...prev, pose]);
    setNavClickMode('none');
  };

  const removePatrolPoint = (id: string) => {
    setPatrolPoints((prev) => prev.filter((point) => point.id !== id));
  };

  const clearPatrolPoints = () => {
    setPatrolPoints([]);
    setNavClickMode('none');
  };

  const startPatrolTask = async () => {
    try {
      if (navigationTaskMode === 'route') {
        await navigationTasks.startRoute(patrolPoints);
        return;
      }

      await navigationTasks.startLoop(patrolPoints);
    } catch (error) {
      console.error('Failed to start patrol task:', error);
    }
  };

  const handleSingleGoalSelected = async (pose: NavigationPose) => {
    try {
      setNavClickMode('none');
      await navigationTasks.startSingleGoal(pose);
    } catch (error) {
      console.error('Failed to start single goal:', error);
    }
  };

  const handleModeChange = (nextMode: 'navigation' | 'teleop') => {
    setActiveConsoleTab(nextMode);
    setMode(nextMode);
  };

  const guidanceText = mode === 'teleop'
    ? '使用 W/A/S/D 或方向键移动机器人'
    : navClickMode === 'initial_pose'
      ? '在地图上拖拽以设置初始位姿'
      : navClickMode === 'goal'
        ? '在地图上拖拽以发送导航目标'
        : navClickMode === 'waypoint'
          ? '在地图上拖拽以添加途经点'
          : navigationTaskMode === 'single'
            ? '单点导航：设置目标点后会立即下发'
            : navigationTaskMode === 'route'
              ? '途经多点：先添加点位，再开始任务'
              : '循环巡航：先添加点位，再开始循环';

  return (
    <div
      className="relative h-screen overflow-hidden bg-slate-950 text-slate-100"
      style={{ backgroundImage: 'url(' + backgroundImage + ')' }}
    >
      <div className="absolute inset-0 bg-slate-950/24" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(14,165,233,0.18),transparent_38%),linear-gradient(90deg,rgba(2,6,23,0.54),rgba(2,6,23,0.18)_45%,rgba(2,6,23,0.62))]" />

      <div className="relative z-10 flex h-full flex-col gap-3 p-4">
        <header className="grid grid-cols-[320px_1fr_520px] items-center gap-5">
          <div className="flex items-center gap-4">
            <img src={logoImage} alt="WebBot-Viz" className="header-logo-image" />
            <div>
              <h1 className="text-2xl font-bold leading-7 tracking-wide text-white">WebBot-Viz</h1>
              <p className="text-sm text-slate-300">机器人控制系统</p>
            </div>
          </div>

          <nav className="header-mode-shell mx-auto">
            <TopModeButton active={activeConsoleTab === 'navigation'} title="导航模式" subtitle="Navigation" icon={Route} onClick={() => handleModeChange('navigation')} />
            <TopModeButton active={activeConsoleTab === 'teleop'} title="遥操作" subtitle="Teleop" icon={Gamepad2} onClick={() => handleModeChange('teleop')} />
            <button
              type="button"
              onClick={() => setActiveConsoleTab('broadcast')}
              className={`header-mode-button group ${activeConsoleTab === 'broadcast' ? 'is-active' : ''}`}
            >
              <Radio className={`h-4 w-4 ${activeConsoleTab === 'broadcast' ? 'text-cyan-300' : 'text-slate-500 group-hover:text-cyan-300'}`} />
              <span><span className="block text-sm font-semibold leading-5">语音广播</span><span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">Broadcast</span></span>
            </button>
          </nav>

          <div className="header-status-shell flex min-w-0 flex-nowrap items-center justify-end gap-4 overflow-hidden px-5 py-3">
            <div className="relative z-10 flex shrink-0 items-center gap-2 whitespace-nowrap">
              <span className={['h-3 w-3 rounded-full', isConnected ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]' : 'bg-slate-500'].join(' ')} />
              <span className="text-sm text-slate-100">{isConnected ? '已连接' : connectionState === 'connecting' ? '连接中' : '未连接'}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">CONNECTED</span>
            </div>
            {rosError && (
              <div className="relative z-10 min-w-0 max-w-36 truncate text-xs text-red-300" title={rosError}>
                {rosError}
              </div>
            )}
            <div className="relative z-10 h-7 w-px bg-cyan-500/25" />
            <span className="relative z-10 shrink-0 whitespace-nowrap text-sm text-slate-300">{reconnectCount || 0} 次尝试</span>
            <div className="relative z-10 h-7 w-px bg-cyan-500/25" />
            <button type="button" onClick={() => setShowDebug(!showDebug)} className="relative z-10 inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-slate-300 transition hover:text-cyan-200">
              调试模式
              <span className={['h-5 w-9 rounded-full p-0.5 transition', showDebug ? 'bg-blue-500/80' : 'bg-slate-600'].join(' ')}><span className={['block h-4 w-4 rounded-full bg-white transition', showDebug ? 'translate-x-4' : ''].join(' ')} /></span>
            </button>
            <div className="relative z-10 h-7 w-px bg-cyan-500/25" />
            <button type="button" className="relative z-10 shrink-0 rounded-md p-1.5 text-slate-300 transition hover:bg-cyan-500/15 hover:text-cyan-200" title="帮助"><CircleHelp className="h-5 w-5" /></button>
            <button type="button" onClick={() => setShowSettings(true)} className="relative z-10 shrink-0 rounded-md p-1.5 text-slate-300 transition hover:bg-cyan-500/15 hover:text-cyan-200" title="设备设置"><Settings className="h-5 w-5" /></button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(560px,1fr)_420px] gap-4">
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <TechPanel title="连接状态" className="operator-panel"><RosbridgePanel isConnected={isConnected} reconnect={reconnect} disconnect={disconnect} profile={config?.profile} rosbridgeUrl={wsUrl} /></TechPanel>
            <TechPanel title={mode === 'teleop' ? '建图控制' : '导航控制'} className="operator-panel" action={<ChevronDown className="h-4 w-4 text-cyan-300" />}>
              {mode === 'teleop' ? (
                <MappingPanel ros={ros} isConnected={isConnected} />
              ) : (
                <NavigationPanel navClickMode={navClickMode} setNavClickMode={setNavClickMode} selectedMap={selectedMap} setSelectedMap={setSelectedMap} taskMode={navigationTaskMode} setTaskMode={setNavigationTaskMode} patrolPoints={patrolPoints} onRemovePatrolPoint={removePatrolPoint} onClearPatrolPoints={clearPatrolPoints} onStartPatrolTask={startPatrolTask} onCancelTask={navigationTasks.cancelCurrentTask} taskStatus={navigationTasks.status} taskRunning={navigationTasks.isRunning} ros={ros} isConnected={isConnected} />
              )}
            </TechPanel>
            <TechPanel title="系统设置">
              <div className="space-y-3 text-sm text-slate-300">
                {[{ icon: Layers, label: '图层管理', value: '已启用' }, { icon: Radio, label: '数据接收', value: subscriptionSettings.paused ? '暂停接收' : '接收中' }, { icon: Activity, label: '接收频率', value: subscriptionSettings.rate > 0 ? subscriptionSettings.rate + ' Hz' : 'Unlimited' }, { icon: MapPinned, label: '当前模式', value: mode === 'teleop' ? '遥操作' : '导航模式' }, { icon: ShieldCheck, label: '网络设置', value: isConnected ? '已连接' : '离线' }].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b border-cyan-400/10 pb-2 last:border-b-0 last:pb-0"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-cyan-300" /><span>{label}</span></div><span className={value === '已连接' || value === '接收中' ? 'text-emerald-300' : 'text-slate-300'}>{value}</span></div>
                ))}
              </div>
            </TechPanel>
            <TechPanel title="最近活动" className="mt-auto">
              <div className="space-y-3 text-sm text-slate-300">
                {[
                  ['16:32:11', '设置初始位姿', 'bg-violet-400'],
                  ['16:32:21', '接收到目标点', 'bg-yellow-400'],
                  ['16:32:21', '路径规划中...', 'bg-yellow-400'],
                  ['16:32:22', isConnected ? '机器人已连接' : '等待机器人连接', isConnected ? 'bg-emerald-400' : 'bg-slate-500'],
                ].map(([time, text, dot]) => (
                  <div key={time + '-' + text} className="flex items-center gap-3">
                    <span className={'h-2.5 w-2.5 rounded-full ' + dot} />
                    <span className="text-slate-400">{time}</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </TechPanel>
          </aside>

          <main className="flex min-h-0 flex-col gap-3">
            <div className="map-frame relative min-h-0 overflow-hidden" style={{ backgroundImage: 'url(' + borderImage + ')' }}>
              {showDebug && <DebugPanel />}
              {mainViewport === 'map' ? (
                <div className="relative z-10 h-full overflow-hidden rounded-lg bg-slate-950/26">
                  <MapCanvas ros={ros} isConnected={isConnected} navClickMode={navClickMode} setNavClickMode={setNavClickMode} selectedMap={selectedMap} navigationTaskMode={navigationTaskMode} navigationPoints={patrolPoints} pathResetToken={navigationTasks.pathResetToken + mapSelectionResetToken} onGoalPoseSelected={(pose) => void handleSingleGoalSelected(pose)} onWaypointAdded={addPatrolPoint} />
                  <div className="absolute left-5 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2"><MapToolButton icon={ZoomIn} /><MapToolButton icon={ZoomOut} /><MapToolButton icon={Maximize2} /><MapToolButton icon={LocateFixed} /><MapToolButton icon={Route} active={navClickMode !== 'none'} /></div>
                  <div className="absolute bottom-5 left-5 z-20 rounded-lg border border-cyan-300/38 bg-slate-950/52 px-4 py-3 text-xs text-slate-200 backdrop-blur-[3px]"><div className="flex items-center gap-2"><Info className="h-4 w-4 text-cyan-300" /><span>{guidanceText}</span></div></div>
                </div>
              ) : (
                <div className="main-camera-view relative z-10 flex h-full items-center justify-center overflow-hidden rounded-lg bg-slate-950/42 p-4">
                  <MediaViewport videoRef={media.videoRef} audioRef={media.audioRef} videoConnected={media.videoConnected} audioMonitoring={media.audioConnected} talkbackActive={media.talkbackActive} loadingAction={media.loadingAction} error={media.error} faceSnapshot={face.snapshot} onRefresh={() => void media.refreshStatus()} onToggleVideo={() => { if (media.videoConnected) { void media.stopVideo(); return; } void media.startVideo(); }} onToggleAudio={() => { if (media.audioConnected) { media.stopAudioMonitor(); return; } void media.startAudioMonitor(); }} onToggleTalkback={() => { if (media.talkbackActive) { void media.stopTalkback(); return; } void media.startTalkback(); }} />
                </div>
              )}
            </div>

            <div className="grid h-56 grid-cols-3 gap-3">
              <TechPanel title="移动控制">
                <div className="motion-control">
                  <div className="motion-pad" onContextMenu={(event) => event.preventDefault()}>
                    <button
                      type="button"
                      disabled={!teleopControlsEnabled}
                      className={`${motionButtonClass} motion-pad-up`}
                      onPointerDown={(event) => handleMotionPointerDown(event, teleop.settings.linearSpeed, 0)}
                      onPointerUp={handleMotionPointerUp}
                      onPointerCancel={handleMotionPointerUp}
                      onLostPointerCapture={stopMotionButton}
                    >
                      <span>前进</span>
                      <b>▲</b>
                    </button>
                    <button
                      type="button"
                      disabled={!teleopControlsEnabled}
                      className={`${motionButtonClass} motion-pad-left`}
                      onPointerDown={(event) => handleMotionPointerDown(event, 0, teleop.settings.angularSpeed)}
                      onPointerUp={handleMotionPointerUp}
                      onPointerCancel={handleMotionPointerUp}
                      onLostPointerCapture={stopMotionButton}
                    >
                      <b>◀</b>
                      <span>左转</span>
                    </button>
                    <button
                      type="button"
                      disabled={!teleopControlsEnabled}
                      className="motion-pad-center"
                      onClick={teleop.sendStop}
                      title="停止"
                    >
                      <span>■</span>
                    </button>
                    <button
                      type="button"
                      disabled={!teleopControlsEnabled}
                      className={`${motionButtonClass} motion-pad-right`}
                      onPointerDown={(event) => handleMotionPointerDown(event, 0, -teleop.settings.angularSpeed)}
                      onPointerUp={handleMotionPointerUp}
                      onPointerCancel={handleMotionPointerUp}
                      onLostPointerCapture={stopMotionButton}
                    >
                      <b>▶</b>
                      <span>右转</span>
                    </button>
                    <button
                      type="button"
                      disabled={!teleopControlsEnabled}
                      className={`${motionButtonClass} motion-pad-down`}
                      onPointerDown={(event) => handleMotionPointerDown(event, -teleop.settings.linearSpeed, 0)}
                      onPointerUp={handleMotionPointerUp}
                      onPointerCancel={handleMotionPointerUp}
                      onLostPointerCapture={stopMotionButton}
                    >
                      <b>▼</b>
                      <span>后退</span>
                    </button>
                  </div>
                </div>
              </TechPanel>
              <TechPanel title="姿态控制">
                <div className="grid h-full grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!teleopControlsEnabled || !teleop.standMode}
                    onClick={() => teleop.setStandMode(false)}
                    className="rounded-md border border-cyan-400/25 bg-slate-950/70 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    趴下
                  </button>
                  <button
                    type="button"
                    disabled={!teleopControlsEnabled || teleop.standMode}
                    onClick={() => teleop.setStandMode(true)}
                    className="rounded-md border border-cyan-400/25 bg-slate-950/70 text-sm font-semibold text-yellow-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    站立
                  </button>
                  <button
                    type="button"
                    disabled={!teleopControlsEnabled}
                    onClick={teleop.toggleStandMode}
                    className="col-span-2 rounded-md border border-cyan-400/25 bg-cyan-500/15 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    当前：{teleop.standMode ? '站立' : '趴下'}，点击切换
                  </button>
                </div>
              </TechPanel>
              <TechPanel title="语音对讲">
                <div className="space-y-3">
                  <div className="rounded-md border border-cyan-400/20 bg-slate-950/65 px-3 py-2 text-sm text-slate-300">
                    {media.talkbackActive ? '麦克风正在发送到机器人' : '麦克风未发送'}
                  </div>
                  <div className="broadcast-waveform flex h-10 items-center gap-1">
                    {Array.from({ length: 44 }).map((_, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-cyan-400"
                        style={{ height: 6 + ((index * 11 + index * index) % 30) + 'px', opacity: media.talkbackActive ? 0.55 + ((index % 5) * 0.09) : 0.22 }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={media.talkbackActive || Boolean(media.loadingAction)}
                      onClick={() => void media.startTalkback()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-400/45 bg-cyan-500/20 px-3 py-2 text-sm text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Mic className="h-4 w-4" />
                      开始对讲
                    </button>
                    <button
                      type="button"
                      disabled={!media.talkbackActive || Boolean(media.loadingAction)}
                      onClick={() => void media.stopTalkback()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/50 bg-red-500/20 px-3 py-2 text-sm text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Square className="h-4 w-4" />
                      停止对讲
                    </button>
                  </div>
                </div>
              </TechPanel>
            </div>
          </main>

          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1">
            <TechPanel
              title={mainViewport === 'map' ? '摄像机视角' : '地图概况'}
              action={(
                <div className="view-switch-control">
                  <button type="button" onClick={() => setMainViewport('map')} className={mainViewport === 'map' ? 'is-active' : ''}>地图</button>
                  <button type="button" onClick={() => setMainViewport('camera')} className={mainViewport === 'camera' ? 'is-active' : ''}>摄像实况</button>
                </div>
              )}
              className="media-panel"
            >
              {mainViewport === 'map' ? (
                <MediaViewport videoRef={media.videoRef} audioRef={media.audioRef} videoConnected={media.videoConnected} audioMonitoring={media.audioConnected} talkbackActive={media.talkbackActive} loadingAction={media.loadingAction} error={media.error} faceSnapshot={face.snapshot} onRefresh={() => void media.refreshStatus()} onToggleVideo={() => { if (media.videoConnected) { void media.stopVideo(); return; } void media.startVideo(); }} onToggleAudio={() => { if (media.audioConnected) { media.stopAudioMonitor(); return; } void media.startAudioMonitor(); }} onToggleTalkback={() => { if (media.talkbackActive) { void media.stopTalkback(); return; } void media.startTalkback(); }} />
              ) : (
                <div className="map-overview relative aspect-video overflow-hidden rounded-xl border border-cyan-400/20 bg-slate-950/50">
                  <MapCanvas ros={ros} isConnected={isConnected} navClickMode="none" selectedMap={selectedMap} navigationTaskMode={navigationTaskMode} navigationPoints={patrolPoints} pathResetToken={navigationTasks.pathResetToken + mapSelectionResetToken} />
                </div>
              )}
            </TechPanel>
            <TechPanel title="图例说明" className="legend-panel"><div className="grid grid-cols-[1fr_150px] gap-3"><LayerControl /><img src={robotWireImage} alt="" className="h-32 w-full object-contain opacity-80" /></div></TechPanel>
            <TechPanel title="机器人状态" className="flex-1">
              <div className="grid grid-cols-[150px_1fr] gap-3">
                <img src={robotImage} alt="" className="h-36 w-full object-contain" />
                <div className="space-y-2">
                  <MetricBar label="电量" value="82%" color="bg-emerald-400" />
                  <MetricBar label="CPU" value={isConnected ? '35%' : '0%'} color="bg-sky-400" />
                  <MetricBar label="内存" value="58%" color="bg-violet-400" />
                  <MetricBar label="温度" value="48%" color="bg-amber-400" />
                  <div className="grid grid-cols-2 gap-2 border-t border-cyan-300/15 pt-2 text-xs text-slate-200">
                    <div>
                      <div className="text-slate-500">机器人 ID</div>
                      <div className="font-semibold text-white">RB-042</div>
                    </div>
                    <div>
                      <div className="text-slate-500">运行时长</div>
                      <div className="font-semibold text-white">02:14:36</div>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-slate-200">
                    <span>当前模式</span>
                    <span>{mode === 'teleop' ? '遥操作' : '导航模式'}</span>
                  </div>
                </div>
              </div>
            </TechPanel>
          </aside>
        </div>
      </div>

      <RobotSettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
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
