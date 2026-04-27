import { useState, useEffect } from 'react';
import { ConnectionStatus } from './components/ConnectionStatus';
import { MediaViewport } from './components/MediaViewport';
import { MapCanvas } from './components/MapCanvas';
import { ImageOverlay } from './components/ImageOverlay';
import { LayerControl, LayerControlProvider, useLayers } from './components/LayerControl';
import { DebugPanel } from './hooks/usePerformanceMonitor';
import { useRosConnection } from './hooks/useRosConnection';
import { useRobotMedia } from './hooks/useRobotMedia';
import { useKeyboardTeleop } from './hooks/useKeyboardTeleop';
import { ModeProvider, useMode } from './hooks/useMode';
import { useSlamControl, useMapManager } from './hooks/useSlamControl';
import { useFaceRecognition } from './hooks/useFaceRecognition';
import { useNavigationTasks } from './hooks/useNavigationTasks';
import { useSystemManager } from './hooks/useSystemManager';
import type { ConnectionState } from './hooks/useRosConnection';
import type { NavigationPose, NavigationTaskMode, NavigationTaskStatus } from './hooks/useNavigationTasks';

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
  face: {
    enabled: boolean;
    latestUrl: string;
    healthUrl: string;
    pollIntervalMs: number;
  };
  topics?: {
    cmdVelTopic?: string;
    motionCmdTopic?: string;
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

function RosbridgePanel({
  isConnected,
  reconnect,
  disconnect,
}: {
  isConnected: boolean;
  reconnect: () => void;
  disconnect: () => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-500">Rosbridge</h3>

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
    await startNav(mapYamlPath, stance, speed);
    setStarting(false);
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
      <div className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded">
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
  const [navigationTaskMode, setNavigationTaskMode] = useState<NavigationTaskMode>('single');
  const [patrolPoints, setPatrolPoints] = useState<NavigationPose[]>([]);
  const navigationTasks = useNavigationTasks(ros, isConnected, config?.navigation || null);

  useKeyboardTeleop(ros, {
    linearSpeed: 0.5,
    angularSpeed: 1.0,
    motionCmdTopic: config?.topics?.motionCmdTopic || '/diablo/MotionCmd',
    standMode: config?.teleop?.standMode ?? false,
    up: config?.teleop?.up ?? 0.0,
    publishRateHz: config?.teleop?.publishRateHz ?? 25,
  }, isConnected && mode === 'teleop');

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

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-800">WebBot-Viz</h1>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">模式：</span>
            <button
              onClick={() => setMode('teleop')}
              className={`px-3 py-1 text-xs rounded ${
                mode === 'teleop'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              遥控
            </button>
            <button
              onClick={() => setMode('navigation')}
              className={`px-3 py-1 text-xs rounded ${
                mode === 'navigation'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              导航
            </button>
          </div>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {showDebug ? '隐藏调试' : '显示调试'}
          </button>
        </div>
        <ConnectionStatus
          connectionState={connectionState as ConnectionState}
          error={rosError}
          reconnect={reconnect}
          reconnectCount={reconnectCount}
        />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="flex w-64 flex-col gap-6 overflow-y-auto border-r bg-white p-4">
          <RosbridgePanel
            isConnected={isConnected}
            reconnect={reconnect}
            disconnect={disconnect}
          />
          {mode === 'teleop' ? (
            <MappingPanel ros={ros} isConnected={isConnected} />
          ) : (
            <NavigationPanel
              navClickMode={navClickMode}
              setNavClickMode={setNavClickMode}
              selectedMap={selectedMap}
              setSelectedMap={setSelectedMap}
              taskMode={navigationTaskMode}
              setTaskMode={setNavigationTaskMode}
              patrolPoints={patrolPoints}
              onRemovePatrolPoint={removePatrolPoint}
              onClearPatrolPoints={clearPatrolPoints}
              onStartPatrolTask={startPatrolTask}
              onCancelTask={navigationTasks.cancelCurrentTask}
              taskStatus={navigationTasks.status}
              taskRunning={navigationTasks.isRunning}
              ros={ros}
              isConnected={isConnected}
            />
          )}
          {/* Media controls moved to the bottom-left camera viewport. */}
          {/* NetworkPanel is hidden for the simplified operator UI. */}
          <div className="mt-auto">
            <MediaViewport
              videoRef={media.videoRef}
              audioRef={media.audioRef}
              videoConnected={media.videoConnected}
              audioMonitoring={media.audioConnected}
              talkbackActive={media.talkbackActive}
              loadingAction={media.loadingAction}
              error={media.error}
              faceSnapshot={face.snapshot}
              onRefresh={() => void media.refreshStatus()}
              onToggleVideo={() => {
                if (media.videoConnected) {
                  void media.stopVideo();
                  return;
                }
                void media.startVideo();
              }}
              onToggleAudio={() => {
                if (media.audioConnected) {
                  media.stopAudioMonitor();
                  return;
                }
                void media.startAudioMonitor();
              }}
              onToggleTalkback={() => {
                if (media.talkbackActive) {
                  void media.stopTalkback();
                  return;
                }
                void media.startTalkback();
              }}
            />
          </div>
        </aside>

        <main className="flex-1 relative">
          {showDebug && <DebugPanel />}
          <MapCanvas
            ros={ros}
            isConnected={isConnected}
            navClickMode={navClickMode}
            setNavClickMode={setNavClickMode}
            selectedMap={selectedMap}
            navigationTaskMode={navigationTaskMode}
            navigationPoints={patrolPoints}
            pathResetToken={navigationTasks.pathResetToken}
            onGoalPoseSelected={(pose) => void handleSingleGoalSelected(pose)}
            onWaypointAdded={addPatrolPoint}
          />
          <div className="absolute bottom-4 right-4 z-20 w-64 max-w-[calc(100%-2rem)] rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
            <LayerControl />
          </div>
          <ImageOverlay ros={ros} hidden={media.videoConnected} />
        </main>
      </div>

      {isConnected && mode === 'teleop' && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm">
          使用 <span className="font-mono">W/A/S/D</span> 或 <span className="font-mono">方向键</span> 移动
        </div>
      )}

      {isConnected && mode === 'navigation' && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm">
          {navClickMode === 'initial_pose'
            ? '在地图上拖拽以设置初始位姿'
            : navClickMode === 'goal'
              ? '在地图上拖拽以发送单点导航目标'
              : navClickMode === 'waypoint'
                ? '在地图上拖拽以添加途经点'
                : navigationTaskMode === 'single'
                  ? '单点导航：设置目标点后会立即下发'
                  : navigationTaskMode === 'route'
                    ? '途经多点：先添加点位，再开始任务'
                    : '循环巡航：先添加点位，再开始循环'}
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
