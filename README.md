# WebBot ROS 项目交接说明

本文档面向接手项目的人，重点说明项目由哪些部分组成、每个目录和关键文件负责什么、前后端与 ROS/Jetson 的接口、网络与部署配置、正常运行链路，以及现场调试时优先检查哪里。

本文档不展开具体代码实现。需要看历史分析时，可继续查 `doc/` 目录中的专题文档。

## 1. 项目总体组成

这个仓库是一个 Web + ROS2 + Jetson 机器人控制与可视化项目，主要由四层组成：

1. 前端 Web 控制台
   - React + Vite + TypeScript。
   - 浏览器中显示地图、TF、scan、路径、视频/音频、人脸识别状态。
   - 通过 roslib 连接 rosbridge，调用 ROS service/action/topic。

2. Bun/Hono 后端
   - 给前端下发配置。
   - 代理 Janus、人脸识别、媒体控制 API。
   - 缓存地图列表。
   - 生成并下发 Jetson 媒体相关 systemd/user service 配置。

3. Jetson ROS2 运行侧
   - `jetson_node_pkg` 是机器人侧主要 ROS 包。
   - 常驻 `rosbridge` 和 `system_manager_node`。
   - 按需启动建图、蹲姿导航、站立导航。
   - 管理地图保存、地图编辑、固定初始位姿、导航启动/停止、底盘停止保护。

4. 媒体与云端访问链路
   - Janus + GStreamer 跑在 Jetson。
   - 云服务器通过 nginx 暴露 HTTPS、API、rosbridge、Janus demo。
   - 云端模式依赖 Jetson 主动建立反向 SSH 隧道。

当前常用机器：

- 云服务器：`182.43.86.126`
- 域名：`qiuhua.ying-guang.com`
- Jetson：`nvidia@192.168.1.58`
- 运动底盘控制侧：`diablo@192.168.1.46`，该侧代码不在本仓库内；本仓库通过 ROS topic `/diablo/MotionCmd` 与其交互。

## 2. 根目录文件和目录作用

### 根目录

- `README.md`
  - 当前交接文档。

- `package.json`
  - Bun workspace 根配置。
  - 定义本地/云端开发、构建、运维检查脚本。
  - 常用命令：
    - `bun run dev:local`：本地开发机 + 局域网直连 Jetson。
    - `bun run dev:cloud`：本地前后端按云端 profile 启动。
    - `bun run build`：构建 server 和 client。
    - `bun run ops:status:cloud`：检查云端和 Jetson 媒体/隧道状态。
    - `bun run ops:nav-load:local`：实时看导航相关进程负载曲线。

- `bun.lock`、`bunfig.toml`
  - Bun 依赖锁定和配置。

- `.python-version`、`pyproject.toml`、`uv.lock`
  - Python 环境相关历史配置。本项目核心运行不主要依赖它们。

- `main.py`
  - 早期占位入口，当前不是主运行入口。

- `img/`
  - 前端 UI 使用的静态图片资源，包括背景、边框、图标。

- `doc/`
  - 历史技术文档与问题分析。
  - 重要参考：
    - `robot_services_ros_audit_2026-04-28.md`：机器人侧服务/ROS 包审计。
    - `navigation_architecture_audit_2026-04-30.md`：导航 TF / base_footprint 重构背景。
    - `navigation_scan_map_drift_root_cause_2026-05-01.md`：scan/map 漂移根因分析。
    - `async_slam_toolbox_oom_root_cause_2026-05-01.md`：SLAM OOM 分析。
    - `rosbridge_connection_modes.md`：local/cloud 两种 rosbridge 连接方式。
    - `rosbridge_disconnect_root_cause_2026-05-01.md`：云端 rosbridge 断连排查。
    - `cloud_deploy.md`：云端部署说明。
    - `webrtc_migration.md`：Janus/WebRTC 接入背景。
    - `约束.md`：早期开发约束。

- `deploy/`
  - 云服务器和 Jetson systemd/nginx/sshd 模板，详见后文。

- `packages/`
  - 前端和后端主代码。

- `jetson_mirror/`
  - Jetson ROS2 工作区中关键文件的镜像副本。
  - 改 Jetson ROS 节点、launch、Nav2/SLAM 参数时主要改这里，再同步到 Jetson `/home/nvidia/ros2_ws`。

- `janus-gateway/`
  - Janus 源码或参考副本。通常不改其核心代码。

- `tools/`
  - 运维与负载排查脚本。

- `refer/`
  - RViz 参考代码，当前主要作为历史参考。

- `qiuhua.ying-guang.com_nginx/`
  - 域名证书相关文件副本。涉及证书时谨慎处理，不建议提交新私钥。

- `.codex_tmp/`
  - 历史临时目录，可作为排查线索，不属于主运行路径。

## 3. 前端目录说明

前端在 `packages/client/`。

### 配置和构建

- `packages/client/package.json`
  - 前端脚本：
    - `bun run --filter client dev`
    - `bun run --filter client build`
    - `bun run --filter client test`
    - `bun run --filter client e2e`

- `packages/client/vite.config.ts`
  - Vite 配置。
  - 本地开发时代理 API/rosbridge 相关入口。

- `packages/client/tailwind.config.js`、`postcss.config.js`
  - Tailwind 和 PostCSS 配置。

- `packages/client/dist/`
  - 构建产物。部署到云服务器 nginx 的 `/usr/share/nginx/html/webbot`。

### 主入口

- `packages/client/src/main.tsx`
  - React 挂载入口。

- `packages/client/src/App.tsx`
  - 前端主应用。
  - 负责：
    - 从 `/api/config` 拉取运行配置。
    - 建立 rosbridge 连接。
    - 管理 Teleop/Navigation 模式。
    - 组织地图、媒体、导航、建图、设置面板。
    - 选择地图、启动导航、启动/保存建图。
    - 固定初始位姿保存。
    - 地图擦除编辑入口。

- `packages/client/src/index.css`
  - 全局样式。

### 主要组件

- `components/MapCanvas.tsx`
  - 2D 地图画布。
  - 负责渲染：
    - `/map` 或静态地图。
    - `/tf`、`/tf_static` 推出的机器人位姿。
    - `/scan_web` 低频激光点。
    - `/plan` 全局路径。
    - 导航点、目标点、初始位姿箭头。
    - 地图擦除预览。
  - 重要行为：
    - 非导航静态预览使用 `/system/static_map`，不使用 `/map`。
    - 导航运行时禁用 `/map` localStorage 缓存，避免冻结旧地图。
    - 导航模式下曾使用“冻结首帧 /map”策略，调试旧地图显示问题时要重点看这里。

- `components/LayerControl.tsx`
  - 图层控制和订阅设置。
  - 控制 map、tf、scan、global plan 是否显示，以及暂停/订阅频率。

- `components/MediaViewport.tsx`
  - 视频画面、音频监听、对讲、人脸识别 overlay 的主显示组件。

- `components/MediaPanel.tsx`
  - 媒体状态面板。

- `components/RobotSettingsPanel.tsx`
  - 前端系统设置弹窗。
  - 调用 `/api/settings` 和 `/api/settings/apply-jetson` 修改并应用 Jetson 媒体/人脸相关配置。

- `components/ConnectionStatus.tsx`
  - 早期连接状态组件，目前主界面更多使用 `App.tsx` 内的面板。

### 前端 hooks

- `hooks/useRosConnection.ts`
  - 连接 rosbridge WebSocket。
  - 维护 disconnected / connecting / connected / error 状态。
  - 有自动重连与手动重连。

- `hooks/useSystemManager.ts`
  - 调用 Jetson `system_manager_node` 暴露的 ROS services。
  - 对应：
    - `/system/status`
    - `/system/start_slam`
    - `/system/start_nav`
    - `/system/stop_all`
    - `/system/save_map`

- `hooks/useSlamControl.ts`
  - `useMapManager`：
    - 优先订阅 `/system/map_list` 获取 Jetson 地图列表。
    - fallback 到后端 `/api/maps`。
    - 收到地图列表后会写入后端 `/api/maps/list` 做云端缓存。
  - `useSlamControl`：
    - 调用后端 `/api/slam/status` 判断建图状态。

- `hooks/useStaticMap.ts`
  - 地图预览和地图编辑的关键 hook。
  - 发布 `/system/request_static_map` 请求 Jetson 读取某张地图。
  - 订阅 `/system/static_map`，根据 `requestId + mapName` 过滤旧消息。
  - 发布 `/system/edit_map` 保存擦除操作。
  - 订阅 `/system/edit_map_result` 获取保存结果。
  - 这是现在正确显示“选中地图”的主链路，不应退回云端 scp 或 `/api/maps/:name/data`。

- `hooks/useRosMap.ts`
  - 订阅 `/map`。
  - 非导航场景允许 localStorage 缓存，导航场景禁用缓存。
  - 调试“地图显示旧版本”时先看这里和 `MapCanvas.tsx`。

- `hooks/useRosTf.ts`
  - 订阅 `/tf`、`/tf_static`。
  - 在前端维护简化的 TF tree，并解析任意 frame 到 map 的 2D 位姿。

- `hooks/useRosScan.ts`
  - 订阅 LaserScan，目前主画布使用 `/scan_web`，不是高频 `/scan`。
  - 这是为了减轻 rosbridge 和浏览器压力。

- `hooks/useRosPath.ts`
  - 订阅 `/plan`。
  - 提供 `/goal_pose` 和 `/initialpose` 发布器。
  - 提供 `/system/fixed_initialpose` 发布器，用于保存某张地图的固定初始位姿。

- `hooks/useNavigationTasks.ts`
  - 使用 rosbridge action 调用 Nav2 `NavigateToPose`。
  - 实现单点、路线、循环巡逻。
  - 取消任务时会取消当前 Nav2 goal 并清理前端路径。

- `hooks/useKeyboardTeleop.ts`
  - Teleop 键盘/按钮控制。
  - 直接发布 `motion_msgs/msg/MotionCtrl` 到 `/diablo/MotionCmd`。
  - 同时可发布 `/stand_cmd`。

- `hooks/useRobotMedia.ts`
  - Janus/WebRTC 前端逻辑。
  - 负责视频下行、音频监听、浏览器到机器人对讲。
  - 调用后端 `/api/media/*`。

- `hooks/useFaceRecognition.ts`
  - 轮询 `/api/face/latest`，给前端做人脸识别 overlay。

- `hooks/useMode.tsx`
  - Teleop / Navigation 模式 context。

- `hooks/usePerformanceMonitor.tsx`
  - 前端调试面板。

- `hooks/useSubscriptionControl.ts`
  - 早期订阅节流逻辑，当前主要图层设置在 `LayerControl`。

## 4. 后端目录说明

后端在 `packages/server/`。

### 配置和入口

- `packages/server/package.json`
  - 后端脚本：
    - `bun run --filter server dev:local`
    - `bun run --filter server dev:cloud`
    - `bun run --filter server start:cloud`
    - `bun run --filter server build`

- `packages/server/src/index.ts`
  - Hono 后端主入口。
  - 负责：
    - `/api/config` 配置下发。
    - `/api/settings` 读取/保存配置。
    - `/api/settings/apply-jetson` 生成并下发 Jetson 媒体/人脸 systemd 配置。
    - `/api/media/*` 代理 Janus 和 Jetson 媒体控制。
    - `/api/face/*` 代理 Jetson 人脸服务。
    - `/api/maps` 和 `/api/maps/list` 地图列表缓存。
    - `/api/slam/status` 和 `/api/network` 辅助状态接口。

- `packages/server/src/config.ts`
  - 简单 YAML 配置加载、保存、合并工具。
  - 支持 `ROBOT_CONFIG_PROFILE` 和 `ROBOT_CONFIG_PATH`。

- `packages/server/config/robot_config.local.yaml`
  - 本地开发 profile。
  - 浏览器直连 Jetson rosbridge：`ws://192.168.1.58:9090`。
  - API 默认在本机 `127.0.0.1:4101`。

- `packages/server/config/robot_config.cloud.yaml`
  - 云端 profile。
  - 浏览器访问 `https://qiuhua.ying-guang.com`。
  - rosbridge 通过云端 nginx `/rosbridge/` 反代到 `127.0.0.1:19090`，再经 SSH 反向隧道回 Jetson `9090`。

- `packages/server/config/robot_config.yaml`
  - 默认配置，目前与云端模式一致。
  - 如果本地开发，推荐显式使用 `ROBOT_CONFIG_PROFILE=local`。

- `packages/server/config/slam_default.yaml`
  - 早期 SLAM Toolbox 默认配置，当前 Jetson 实际建图主要使用 `/home/nvidia/ros2_ws/my_slam.yaml`，镜像在 `jetson_mirror/my_slam.yaml`。

### 后端静态/缓存数据

- `packages/server/maps-list.json`
  - 云服务器缓存的 Jetson 地图列表。
  - 前端断开 ROS 或还未收到 `/system/map_list` 时，会 fallback 到这里。

- `packages/server/maps/`
  - 历史云端地图文件目录。
  - 当前地图显示/编辑不应该依赖这里的地图文件，地图本体应以 Jetson topic 或 Jetson 文件为准。

- `packages/server/src/map_throttle.py`
  - ROS map 节流节点的服务端副本/历史版本。

- `packages/server/src/system_manager_node.py`
  - Jetson `system_manager_node.py` 的服务端镜像。
  - 真实运行在 Jetson 的文件以 `jetson_mirror/jetson_node_pkg/.../system_manager_node.py` 同步过去为准。

### 后端 systemd/media 模板

- `packages/server/systemd/webbot-media.sh`
  - Jetson 用户级媒体服务主脚本。
  - 生成 Janus runtime 配置。
  - 启动 Janus、Janus demo HTTP server、音频采集、音频回放等。

- `packages/server/systemd/webbot-video.sh`
  - Jetson 视频采集脚本。
  - 使用 GStreamer 从摄像头取流。
  - 一路送 H264 RTP 到 Janus streaming UDP 端口。
  - 另一路生成 JPEG 帧给人脸识别。

- `packages/server/systemd/webbot-media-control.py`
  - Jetson 本地媒体控制 HTTP API。
  - 提供状态、启动/停止视频服务等能力。
  - 后端 `/api/media/video/*` 会代理到这里。

- `packages/server/systemd/webbot-face-service.py`
  - Jetson 人脸识别服务。
  - 读取视频服务生成的 JPEG 帧。
  - 使用 InsightFace/ONNXRuntime 做识别。
  - 提供 `/health` 和 `/faces/latest`。

- `packages/server/systemd/webbot-*.service`
  - Jetson 用户级 systemd 模板，包括媒体、视频、人脸、隧道等。

### 数据库

- `packages/server/db/index.ts`、`packages/server/db/schema.ts`
  - Drizzle/SQLite 相关早期认证表。
  - 当前主控制链路基本没有依赖认证数据库。

## 5. Jetson ROS 目录说明

Jetson 镜像目录在 `jetson_mirror/`。真实部署位置通常是：

- `/home/nvidia/ros2_ws/src/jetson_node_pkg`
- `/home/nvidia/ros2_ws/*.yaml`
- `/home/nvidia/livox_ws`
- `/home/nvidia/maps`

### ROS 包

- `jetson_mirror/jetson_node_pkg/setup.py`
  - 注册 ROS console scripts。
  - 修改或新增节点后要确认 entry point。

- `jetson_mirror/jetson_node_pkg/package.xml`
  - ROS 包依赖声明。

- `jetson_mirror/jetson_node_pkg/launch/system_manager.launch.py`
  - 常驻 system_manager 启动文件。
  - 由 systemd `webbot-system-manager.service` 调用。

- `jetson_mirror/jetson_node_pkg/launch/mapping_all.launch.py`
  - 建图完整链路。
  - 启动 Livox、FAST-LIO、TF、base_footprint_projector、pointcloud_to_laserscan、scan_throttle、map_throttle、slam_toolbox。

- `jetson_mirror/jetson_node_pkg/launch/nav_all.launch.py`
  - 蹲姿导航。
  - 启动 Livox、FAST-LIO、TF、base_footprint_projector、pointcloud_to_laserscan、scan_throttle、map_throttle、cmd_vel_converter。
  - 延迟启动 Nav2 bringup。

- `jetson_mirror/jetson_node_pkg/launch/stand_nav_launch.py`
  - 站立导航。
  - 与蹲姿导航类似，但使用 `stand_cmd_vel_converter` 和站立 Nav2 参数。
  - 有 `start_livox` 参数，默认 `true`。如果现场需要站立导航不启动 Livox，应由启动参数传 `start_livox:=false` 或在 system_manager 启动参数中显式追加。
  - 当前站立点云切片是“雷达下方 20cm、上方 20cm”，参数为 `min_height: 0.15`、`max_height: 0.55`。

- `jetson_mirror/jetson_node_pkg/launch/mapping_nav_launch.py`
  - 边建图边导航的历史/实验 launch，不是当前主路径。

- `jetson_mirror/jetson_node_pkg/launch/stand_down_nav_launch.py`
  - 旧站立/蹲下导航实验 launch，不是当前主路径。

- `jetson_mirror/jetson_node_pkg/launch/sensors_tf.launch.py`
  - 早期传感器 TF 和点云转 scan 测试 launch。

### Jetson ROS 节点

- `system_manager_node.py`
  - 机器人侧核心管理节点。
  - ROS services：
    - `/system/start_slam`
    - `/system/start_nav`
    - `/system/stop_all`
    - `/system/save_map`
    - `/system/status`
  - ROS topics：
    - 发布 `/system/map_list`
    - 订阅 `/system/request_static_map`
    - 发布 `/system/static_map`
    - 订阅 `/system/edit_map`
    - 发布 `/system/edit_map_result`
    - 订阅 `/system/fixed_initialpose`
    - 发布 `/initialpose`
    - 订阅/发布 `/cmd_vel` 做导航停发保护
    - 发布 `/diablo/MotionCmd` 做底盘停止保护
  - 管理：
    - 建图/导航 launch 子进程。
    - 启动前清理残留 ROS 进程。
    - 地图保存到 `/home/nvidia/maps`。
    - 地图列表发布和上传缓存。
    - 固定初始位姿文件 `<map>.initialpose.json`。
    - 地图编辑 PGM 写回和 `.bak_时间戳` 备份。

- `base_footprint_projector.py`
  - 订阅 FAST-LIO `/Odometry`。
  - 发布平面导航用 TF：
    - `camera_init -> base_footprint`
    - `base_footprint -> base_link`
  - 目的是把机身高度、roll、pitch 与 2D 导航平面隔离。

- `scan_throttle.py`
  - `/scan` 到 `/scan_web` 的低频转发。
  - 前端显示 scan 时应该看 `/scan_web`，不要直接吃高频 `/scan`。

- `map_throttle.py`
  - `/map` 到 `/map_web` 的变更节流。
  - 当前前端主画布仍主要看 `/map` 或 `/system/static_map`；`/map_web` 是可用于降载的辅助 topic。

- `cmd_vel_converter.py`
  - 蹲姿导航用。
  - 把 Nav2 `/cmd_vel` 转为 `/diablo/MotionCmd`。
  - 也订阅 `/stand_cmd`。

- `stand_cmd_vel_converter.py`
  - 站立导航用。
  - 同样把 `/cmd_vel` 转为 `/diablo/MotionCmd`，但站立控制参数不同。

- `continuous_tf_pub.py`、`stand_continuous_tf_pub.py`
  - 早期持续 TF 发布节点。
  - 当前主 launch 更多使用 static_transform_publisher 和 base_footprint_projector。

- `stop_guard.py`
  - 监听 `/cmd_vel`，超时发布停止 MotionCtrl。
  - 与 system_manager 内部 watchdog 思路类似，是安全辅助节点。

- `stand_test.py`、`sit_down_test.py`、`stop_test.py`
  - 调试站立、蹲下、停止的小工具。

### Jetson 参数文件

- `mid360.yaml`
  - FAST-LIO/Livox MID360 参数镜像。
  - 重要字段：
    - `point_filter_num`
    - `max_iteration`
    - `filter_size_surf`
    - `filter_size_map`
    - `cube_side_length`
    - `common.lid_topic`
    - `common.imu_topic`
    - `common.map_frame`
    - `common.body_frame`
  - 负载优化优先看这里。

- `my_slam.yaml`
  - 建图用 slam_toolbox 参数。
  - 关键看 frame、scan_topic、map_update_interval、throttle_scans、range、TF timeout。

- `my_nav2_params.yaml`
  - 蹲姿高速导航参数。

- `my_nav2_params_medium.yaml`
  - 蹲姿中速导航参数。

- `my_nav2_params_low.yaml`
  - 蹲姿低速导航参数。

- `stand_nav2_params_high.yaml`
  - 站立高速导航参数。

- `stand_nav2_params_medium.yaml`
  - 站立中速导航参数。

- `stand_nav2_params_low.yaml`
  - 站立低速导航参数。

Nav2 参数调试重点：

- `amcl`
  - `base_frame_id: base_footprint`
  - `odom_frame_id: odom`
  - `global_frame_id: map`
  - `scan_topic: scan`
  - `min_particles/max_particles`
  - `update_min_d/update_min_a`
  - `transform_tolerance`

- `local_costmap`
  - `global_frame: odom`
  - `robot_base_frame: base_footprint`
  - `rolling_window`
  - `robot_radius`
  - `voxel_layer`
  - `scan` observation source 的高度、range。

- `global_costmap`
  - `global_frame: map`
  - `static_layer`
  - `obstacle_layer`
  - `map_subscribe_transient_local`

- `controller_server / FollowPath`
  - `max_vel_x`
  - `max_vel_theta`
  - `acc_lim_*`
  - `sim_time`
  - critics 权重。

## 6. deploy 目录说明

### 云服务器 nginx

- `deploy/nginx/webbot.conf`
  - `80` 跳转 `443`。
  - 静态前端 root：`/usr/share/nginx/html/webbot`。
  - `/api/` 反代后端 `127.0.0.1:4001`。
  - `/rosbridge/` 反代本机 `127.0.0.1:19090`，这个端口由 Jetson SSH reverse tunnel 提供。
  - `/janus-demo/` 反代本机 `127.0.0.1:18000`。

### 云服务器 systemd

- `deploy/systemd/webbot-server.service`
  - 云服务器后端服务。
  - WorkingDirectory：`/opt/webbot/packages/server`
  - `ROBOT_CONFIG_PROFILE=cloud`
  - `bun run start:cloud`

### Jetson systemd

- `deploy/systemd/webbot-rosbridge.service`
  - Jetson 系统级 rosbridge 常驻服务。
  - User：`nvidia`
  - 调用 `/home/nvidia/start_rosbridge.sh`。

- `deploy/systemd/start_rosbridge.sh`
  - source ROS Humble 和 `/home/nvidia/ros2_ws/install/setup.bash`。
  - 设置：
    - `ROS_DOMAIN_ID=1`
    - `RMW_IMPLEMENTATION=rmw_fastrtps_cpp`
  - 启动 `rosbridge_websocket`，监听 `0.0.0.0:9090`。

- `deploy/systemd/webbot-system-manager.service`
  - Jetson 系统级 system_manager 常驻服务。
  - 依赖 rosbridge。
  - 启动前后运行 cleanup 脚本。
  - 调用 `/home/nvidia/start_system_manager.sh`。

- `deploy/systemd/start_system_manager.sh`
  - 与 rosbridge 相同 ROS 环境。
  - 启动 `jetson_node_pkg system_manager.launch.py`。

- `deploy/systemd/webbot-cleanup-ros.sh`
  - 清理建图/导航/Nav2/FAST-LIO/Livox/转换节点等残留进程。
  - system_manager 启动/停止时都会用到。

### SSH 隧道配置

- `deploy/sshd/99-webbot-tunnels.conf`
  - 云服务器 sshd 配置补充。
  - 开启 TCP forwarding。
  - 设置 keepalive 和 MaxStartups。

## 7. 网络配置与访问模式

### local 模式

用途：开发机和 Jetson 在同一个局域网。

配置文件：

- `packages/server/config/robot_config.local.yaml`

关键地址：

- 后端：`http://127.0.0.1:4101`
- 前端开发服务：通常是 Vite 默认端口。
- rosbridge：`ws://192.168.1.58:9090`
- Jetson：`192.168.1.58`
- Janus HTTP：`http://192.168.1.58:8088`
- Janus demo：`http://192.168.1.58:8000`
- 媒体控制：`http://192.168.1.58:19110`
- 人脸服务：`http://192.168.1.58:19100`

启动方式：

- `bun run dev:local`

### cloud 模式

用途：浏览器访问云服务器，Jetson 通过反向 SSH 隧道把本机服务暴露到云服务器。

配置文件：

- `packages/server/config/robot_config.cloud.yaml`
- `packages/server/config/robot_config.yaml`

关键地址：

- 前端：`https://qiuhua.ying-guang.com`
- API：`https://qiuhua.ying-guang.com/api`
- rosbridge：`wss://qiuhua.ying-guang.com/rosbridge/`
- 云服务器后端：`127.0.0.1:4001`
- 云服务器 rosbridge tunnel 入口：`127.0.0.1:19090`
- 云服务器 Janus HTTP tunnel：`127.0.0.1:18088`
- 云服务器 Janus demo tunnel：`127.0.0.1:18000`
- 云服务器 face tunnel：`127.0.0.1:19100`
- 云服务器 media-control tunnel：`127.0.0.1:19110`

典型链路：

- 浏览器 WebSocket：
  - 浏览器 `wss://qiuhua.ying-guang.com/rosbridge/`
  - nginx `/rosbridge/`
  - 云服务器 `127.0.0.1:19090`
  - SSH reverse tunnel
  - Jetson `127.0.0.1:9090`
  - rosbridge

- 视频：
  - Jetson 摄像头
  - GStreamer H264 RTP 到 Janus
  - Janus streaming plugin
  - 云端 nginx/Janus demo/API 代理
  - 浏览器 WebRTC 播放

- 对讲：
  - 浏览器麦克风进入 Janus AudioBridge
  - 后端请求 Janus 开 RTP forward
  - Janus 把 OPUS RTP 转到 Jetson `127.0.0.1:5006`
  - Jetson GStreamer `udpsrc -> opusdec -> alsasink`

## 8. 前后端 HTTP API 文档

所有 HTTP API 在 `packages/server/src/index.ts`。

### 基础配置

- `GET /api/health`
  - 检查后端是否在线。
  - 返回状态和时间戳。

- `GET /api/config`
  - 前端启动时调用。
  - 返回：
    - 当前 profile。
    - `rosbridgeUrl`。
    - Jetson host/rosbridgePort。
    - Janus 相关 URL。
    - 人脸识别 API URL。
    - ROS topic 名称。
    - teleop 参数。
    - Nav2 action 名称。

- `GET /api/network`
  - 返回后端所在机器 IP 列表、hostname、端口。
  - Jetson 早期自动发现服务器地址时会用到。

### 设置与应用到 Jetson

- `GET /api/settings`
  - 读取当前 robot_config。
  - 返回 Jetson、媒体、人脸、反向隧道配置和生成的 systemd ExecStart 信息。

- `POST /api/settings`
  - 保存设置到当前 profile 对应 YAML。
  - 可修改 Jetson host、rosbridge port、摄像头、音频设备、Janus 端口、人脸参数、反向隧道端口等。

- `POST /api/settings/apply-jetson`
  - 根据当前配置生成 Jetson 用户级 systemd 服务、脚本、环境文件。
  - 通过 SSH 下发到 Jetson。
  - 重载并重启媒体、人脸、控制服务。
  - 调试媒体链路配置时非常重要。

### 媒体与 Janus

- `GET /api/media/assets/*`
  - 提供 Janus 前端脚本等资源。

- `ALL /api/media/janus`
- `ALL /api/media/janus/*`
  - 代理 Janus HTTP API。

- `GET /api/media/status`
  - 汇总 Janus 可用性、对讲 RTP forward、视频服务、音频采集/回放状态。
  - 前端媒体面板的主要状态来源。

- `GET /api/media/video/status`
  - 代理 Jetson media-control `/status`。

- `POST /api/media/video/start`
  - 启动 Jetson 视频服务。

- `POST /api/media/video/stop`
  - 停止 Jetson 视频服务。

- `POST /api/media/talkback/forward/start`
  - 让 Janus AudioBridge 把浏览器对讲音频 RTP forward 到 Jetson 播放端口。

- `POST /api/media/talkback/forward/stop`
  - 停止对讲 RTP forward。

### 人脸识别

- `GET /api/face/health`
  - 代理 Jetson 人脸服务 `/health`。
  - 看模型、身份库、帧更新时间、最后错误。

- `GET /api/face/latest`
  - 代理 Jetson 人脸识别最新结果。
  - 前端 overlay 使用。

### 地图与建图状态

- `GET /api/maps`
  - 返回云端缓存的地图列表。
  - 注意：这是列表缓存，不是地图真实来源。

- `POST /api/maps/list`
  - 写入云端 `maps-list.json`。
  - 前端 `useMapManager` 收到 Jetson `/system/map_list` 后会调用它更新缓存。

- `GET /api/maps/:name/data`
  - 旧静态地图文件读取接口。
  - 当前不应作为前端选图显示的主链路，因为云端不一定有地图文件本体。
  - 当前正确链路是 `/system/request_static_map -> /system/static_map`。

- `DELETE /api/maps/:name`
  - 删除云端 `packages/server/maps` 中的历史地图文件。
  - 不会删除 Jetson `/home/nvidia/maps` 里的真实地图。

- `GET /api/slam/status`
  - 检查后端机器上的 SLAM 进程或 `/map` 发布情况。
  - 这个接口有历史本地仿真背景，Jetson 真实状态更可靠的是 `/system/status`。

## 9. ROS 接口文档

### 常驻 ROS services

由 Jetson `system_manager_node` 提供：

- `/system/status`
  - 类型：`std_srvs/srv/Trigger`
  - 返回当前模式：`idle|slam|navigation` 和 PID。
  - 前端每 5 秒轮询。

- `/system/start_slam`
  - 类型：`std_srvs/srv/Trigger`
  - 停止当前任务并启动 `mapping_all.launch.py`。

- `/system/start_nav`
  - 类型：`jetson_interfaces/srv/StartNav`
  - 请求字段包含：
    - `map_yaml_file`
    - `stance`：`stand` 或 `crouch`
    - `speed`：`high`、`medium`、`low`
  - 根据 stance 选择站立或蹲姿 launch。
  - 根据 speed 选择 Nav2 参数文件。

- `/system/stop_all`
  - 类型：`std_srvs/srv/Trigger`
  - 停止当前建图/导航。
  - 发布零 `/cmd_vel` 和底盘停止 MotionCtrl。

- `/system/save_map`
  - 类型：`std_srvs/srv/Trigger`
  - 调用 `nav2_map_server map_saver_cli` 保存当前 `/map`。
  - 保存到 `/home/nvidia/maps/map_<timestamp>.yaml/.pgm`。
  - 保存后发布 `/system/map_list`。

### 常驻/辅助 ROS topics

- `/system/map_list`
  - 类型：`std_msgs/msg/String`
  - 内容为 JSON。
  - Jetson 地图列表，带 transient local QoS。

- `/system/request_static_map`
  - 类型：`std_msgs/msg/String`
  - 前端请求 Jetson 读取某张地图文件并发布为 OccupancyGrid。
  - payload 包含 `requestId`、`mapName`、`mapYamlFile`。

- `/system/static_map`
  - 类型：`nav_msgs/msg/OccupancyGrid`
  - Jetson 按需发布静态地图。
  - `header.frame_id` 格式为 `static_map|<requestId>|<mapName>`。
  - 前端必须按 requestId 和 mapName 过滤，避免旧消息。

- `/system/edit_map`
  - 类型：`std_msgs/msg/String`
  - 前端地图擦除保存请求。
  - payload 包含 `requestId`、`mapName`、`mapYamlFile`、`operation: erase`、`cells`。
  - Jetson 只允许编辑 `/home/nvidia/maps` 下的地图，并且导航/建图运行中会拒绝。

- `/system/edit_map_result`
  - 类型：`std_msgs/msg/String`
  - 地图编辑结果。
  - 包含 success、message、changedCount、backupPath。

- `/system/fixed_initialpose`
  - 类型：`std_msgs/msg/String`
  - 前端保存某地图固定初始位姿。
  - Jetson 写成 `<map>.initialpose.json`。
  - 下次启动导航时 system_manager 会延迟多次发布 `/initialpose`。

- `/cmd_vel`
  - 类型：`geometry_msgs/msg/Twist`
  - Nav2 输出。
  - `cmd_vel_converter` 或 `stand_cmd_vel_converter` 转换到底盘 MotionCtrl。

- `/diablo/MotionCmd`
  - 类型：`motion_msgs/msg/MotionCtrl`
  - 真实底盘控制 topic。
  - Teleop 前端也会直接发这个 topic。

- `/stand_cmd`
  - 类型：`std_msgs/msg/Bool`
  - 站立/蹲下辅助命令。

### 建图/导航启动后出现的 ROS topics/actions

- `/map`
  - `nav_msgs/msg/OccupancyGrid`
  - 建图时由 slam_toolbox 发布。
  - 导航时由 Nav2 map_server 发布。

- `/scan`
  - `sensor_msgs/msg/LaserScan`
  - 由 `pointcloud_to_laserscan` 从 FAST-LIO 点云切片得到。

- `/scan_web`
  - `sensor_msgs/msg/LaserScan`
  - 由 `scan_throttle` 低频发布，前端显示用。

- `/tf`、`/tf_static`
  - TF tree。
  - 核心链路通常围绕 `map -> odom/camera_init -> base_footprint -> base_link -> camera_link`。

- `/Odometry`
  - FAST-LIO 输出里程计。

- `/cloud_registered_body`
  - FAST-LIO 输出点云。
  - `pointcloud_to_laserscan` 的输入。

- `/plan`
  - Nav2 全局规划路径。

- `/goal_pose`
  - 前端点击单点目标时可直接发布 PoseStamped。

- `/initialpose`
  - 前端设置初始位姿或 system_manager 自动发布固定初始位姿。

- `/navigate_to_pose`
  - Nav2 action。
  - 前端巡逻/路线/单点任务走这个 action。

## 10. 正常运行完整链路

### 系统空闲启动

1. Jetson 开机。
2. `webbot-rosbridge.service` 启动 rosbridge。
3. `webbot-system-manager.service` 启动 system_manager。
4. system_manager 发布 `/system/map_list`。
5. 云端模式下，Jetson 用户级隧道服务把 rosbridge、Janus、人脸、媒体控制端口反向映射到云服务器。
6. 云服务器 nginx 对外提供 HTTPS、API、rosbridge、Janus demo。

空闲状态下常见 ROS 节点：

- `/rosbridge_websocket`
- `/rosapi`
- `/system_manager_node`
- `/diablo_ctrl_node` 或底盘相关节点

### 前端加载

1. 浏览器打开前端。
2. 前端调用 `/api/config`。
3. 前端根据返回的 `rosbridgeUrl` 建立 WebSocket。
4. 前端订阅：
   - `/system/map_list`
   - `/tf`、`/tf_static`（按图层开关）
   - 需要时订阅 `/scan_web`、`/map`、`/plan`
5. 前端媒体模块按需调用 `/api/media/status`、`/api/face/latest`。

### 建图流程

1. 用户在前端建图面板点击启动。
2. 前端调用 `/system/start_slam`。
3. system_manager 清理旧进程。
4. 启动 `mapping_all.launch.py`：
   - Livox 驱动。
   - FAST-LIO。
   - 静态 TF。
   - `base_footprint_projector`。
   - `pointcloud_to_laserscan`。
   - `scan_throttle`。
   - `map_throttle`。
   - `slam_toolbox`。
5. 前端显示 `/map`、`/scan_web`、TF。
6. 用户保存地图。
7. 前端调用 `/system/save_map`。
8. Jetson 保存 `/home/nvidia/maps/map_<timestamp>.yaml/.pgm`。
9. system_manager 发布新的 `/system/map_list`。
10. 前端收到列表并同步到云端 `/api/maps/list`。

### 静态地图预览与编辑流程

1. 用户在导航页选择地图。
2. 前端发布 `/system/request_static_map`。
3. Jetson 读取 `/home/nvidia/maps/<map>.yaml/.pgm`。
4. Jetson 发布 `/system/static_map`。
5. 前端按 `requestId + mapName` 过滤，只显示本次请求的地图。
6. 用户开启“擦除”工具。
7. 前端把鼠标擦过的栅格 cell 收集为 pending cells。
8. 用户点击保存。
9. 前端发布 `/system/edit_map`。
10. Jetson 检查当前没有导航/建图在运行。
11. Jetson 备份 PGM 到 `.bak_时间戳`。
12. Jetson 写回 PGM。
13. Jetson 发布 `/system/edit_map_result`。
14. 前端收到成功结果后重新请求 `/system/static_map`。

调试重点：

- 如果选择地图后不显示，查 `/system/request_static_map` 和 `/system/static_map`。
- 如果显示上一张地图，查 `requestId + mapName` 过滤和前端缓存。
- 如果保存失败，查 `/system/edit_map_result` 和 system_manager journal。
- 如果导航启动后又出现旧地图，查前端是否读了 `/map` localStorage 缓存；当前已在导航模式禁用。

### 导航流程

1. 用户选择地图、姿态、速度。
2. 前端调用 `/system/start_nav`。
3. system_manager 清理旧进程，检查地图文件存在。
4. 如果 `stance=crouch`，启动 `nav_all.launch.py`。
5. 如果 `stance=stand`，启动 `stand_nav_launch.py`。
6. launch 启动 FAST-LIO、TF、base_footprint、点云切片、scan_web、底盘 cmd_vel 转换节点。
7. 延迟约 10 秒启动 Nav2 bringup。
8. Nav2 map_server 读取所选 YAML/PGM 并发布 `/map`。
9. 如果该地图有 `<map>.initialpose.json`，system_manager 延迟发布多次 `/initialpose`。
10. 前端可以点击目标点或启动巡逻。
11. 前端通过 Nav2 action `/navigate_to_pose` 发 goal。
12. Nav2 输出 `/cmd_vel`。
13. 转换节点发布 `/diablo/MotionCmd` 控制底盘。
14. system_manager watchdog 监测 `/cmd_vel`，超时发布停止。

### 媒体流程

1. 用户点击视频。
2. 前端调用 `/api/media/video/start`。
3. 后端代理到 Jetson `webbot-media-control.py`。
4. Jetson 用户级 systemd 启动 `webbot-video.service`。
5. `webbot-video.sh` 启动 GStreamer 摄像头管线。
6. Janus streaming 通过 RTP 收到视频。
7. 前端 `useRobotMedia` 建 Janus session，播放视频。
8. 人脸服务读取视频服务生成的 JPEG 帧，前端定时拉 `/api/face/latest` 显示 overlay。

对讲：

1. 用户点击对讲。
2. 浏览器请求麦克风权限。
3. 前端加入 Janus AudioBridge。
4. 后端调用 Janus 开 RTP forward 到 Jetson `5006`。
5. Jetson `webbot-media.sh` 中的音频回放 GStreamer 管线播放。

## 11. 运行和部署

### 本地开发

1. 安装依赖：
   - `bun install`

2. 本地 profile：
   - `bun run dev:local`

3. 云端 profile 本地调试：
   - `bun run dev:cloud`

4. 构建：
   - `bun run build`

### 前端部署到云服务器

当前惯用方式：

- 本地构建 client。
- 将 `packages/client/dist` 同步到云服务器 `/usr/share/nginx/html/webbot`。
- reload nginx。

### 后端部署到云服务器

云服务器目标目录通常是：

- `/opt/webbot`

systemd：

- `webbot-server.service`

检查：

- `systemctl status webbot-server`
- `journalctl -u webbot-server -f`
- `curl http://127.0.0.1:4001/api/health`

### Jetson ROS 部署

常用同步目标：

- `jetson_mirror/jetson_node_pkg/...` -> `/home/nvidia/ros2_ws/src/jetson_node_pkg/...`
- `jetson_mirror/*.yaml` -> `/home/nvidia/ros2_ws/*.yaml`

构建：

- `cd ~/ros2_ws`
- `source /opt/ros/humble/setup.bash`
- `colcon build --packages-select jetson_node_pkg --symlink-install`

重启 system_manager：

- 如果没有导航/建图在跑，可以重启 `webbot-system-manager.service`。
- 如果没有 sudo，可杀掉当前 nvidia 用户的 system_manager launch 主进程，让 systemd 拉起。

注意：

- 重启 system_manager 会停止当前导航/建图，因为 service 有 cleanup。
- 部署 launch 或 system_manager 后必须重启 system_manager 才生效。
- 只改前端不需要重启 Jetson。

## 12. 调试命令和排障入口

### 云服务器

- 后端日志：
  - `journalctl -u webbot-server -f`

- nginx 日志：
  - `journalctl -u nginx -f`
  - 或查看 nginx access/error log。

- 端口：
  - `ss -ltnp | grep -E '4001|19090|18088|18000|19100|19110'`

- API：
  - `curl http://127.0.0.1:4001/api/health`
  - `curl http://127.0.0.1:4001/api/media/status`
  - `curl http://127.0.0.1:4001/api/settings`

### Jetson ROS

注意 ROS domain：

- 常驻服务使用 `ROS_DOMAIN_ID=1`。
- 手工查 ROS graph 时要设置同样的 domain。

常用：

- `journalctl -u webbot-system-manager.service -f`
- `journalctl -u webbot-rosbridge.service -f`
- `ROS_DOMAIN_ID=1 ros2 node list`
- `ROS_DOMAIN_ID=1 ros2 node info /system_manager_node`
- `ROS_DOMAIN_ID=1 ros2 topic list`
- `ROS_DOMAIN_ID=1 ros2 service list`

检查 system_manager 接口：

- `/system/start_slam`
- `/system/start_nav`
- `/system/stop_all`
- `/system/save_map`
- `/system/status`
- `/system/map_list`
- `/system/static_map`
- `/system/edit_map_result`

### 导航负载

本地工具：

- `bun run ops:nav-load:local`
- `bun run ops:nav-load:cloud`

重点观察：

- `fastlio`
- `livox`
- `scan_slice`
- `base_footprint`
- `amcl`
- `controller`
- `planner`
- `rosbridge`

如果出现：

- `Message Filter dropping message`
- `timestamp earlier than all data in transform cache`
- `Lookup would require extrapolation`

优先查：

- FAST-LIO 是否卡顿。
- `/Odometry` 时间戳是否滞后。
- `base_footprint_projector` 是否正常。
- `/scan` 和 TF 的时间是否一致。
- CPU/mem 是否被 FAST-LIO、Livox、pointcloud_to_laserscan、rosbridge 占满。

### rosbridge 连接

- `bun run tools/probe-rosbridge.ts -- --url=wss://qiuhua.ying-guang.com/rosbridge/`
- `tools/measure-topic-load.sh ws://192.168.1.58:9090 10`

排查：

- 本地模式先看 Jetson `9090`。
- 云端模式先看云服务器 `19090` 是否监听。
- 如果云端断连但 Jetson rosbridge 正常，查反向 SSH 隧道和 usb0/流量卡。

### 媒体/人脸

一键状态：

- `bun run ops:status:cloud`
- `bun run ops:status:local`

Jetson 用户级服务：

- `systemctl --user status webbot-media.service`
- `systemctl --user status webbot-video.service`
- `systemctl --user status webbot-media-control.service`
- `systemctl --user status webbot-face.service`

Jetson 端口：

- `8088`：Janus HTTP
- `8000`：Janus demo
- `19110`：media control
- `19100`：face service
- `5005`：音频采集 RTP
- `5006`：音频回放 RTP
- `8004`：视频 RTP

声卡/摄像头：

- `aplay -l`
- `arecord -l`
- `v4l2-ctl --list-devices`
- `ss -lunp | grep -E '5005|5006|8004'`

### 地图编辑

只读测试静态地图：

- 发布 `/system/request_static_map`。
- 等 `/system/static_map`。
- frame_id 应为 `static_map|requestId|mapName`。

保存编辑失败时：

- 查 `/system/edit_map_result`。
- 查 `journalctl -u webbot-system-manager.service -f`。
- 确认当前没有导航或建图运行。
- 确认目标文件在 `/home/nvidia/maps`。
- 确认 PGM 是 P5 格式。

## 13. 常见问题和优先排查顺序

### 前端连不上 ROS

1. 看 `/api/config` 下发的 `rosbridgeUrl`。
2. local 模式查 `ws://192.168.1.58:9090`。
3. cloud 模式查 `wss://qiuhua.ying-guang.com/rosbridge/`。
4. Jetson 查 `webbot-rosbridge.service`。
5. 云端查 nginx `/rosbridge/` 和 `127.0.0.1:19090`。

### 选择地图后不显示

1. 确认 ROS 已连接。
2. 看 `/system/map_list` 是否有地图。
3. 看 `/system/request_static_map` 是否发出。
4. 看 `/system/static_map` 是否回包。
5. 看 frame_id 是否匹配当前 requestId/mapName。
6. 不要去云服务器 scp 地图文件；前端静态地图主链路是 topic。

### 编辑地图后导航还显示旧地图

1. 确认 PGM 文件确实变了。
2. 确认启动导航后 map_server 读取的是同一个 YAML。
3. 前端导航模式不应读取 `/map` localStorage 缓存；当前已禁用。
4. 如果仍旧，查 `/map` 实际内容，而不是只看前端显示。

### 导航撞墙或 scan/map 漂移

1. 先确认地图与 scan 是否对齐。
2. 查 AMCL 是否收到 `/scan`。
3. 查 TF：
   - `map`
   - `odom`
   - `camera_init`
   - `base_footprint`
   - `base_link`
4. 查日志中的 transform timeout/extrapolation。
5. 用 `ops:nav-load` 看 FAST-LIO、Livox、pointcloud_to_laserscan、base_footprint_projector 负载。
6. 查点云切片高度范围是否符合姿态：
   - 建图：雷达下方 20cm、上方 20cm。
   - 站立导航：雷达下方 20cm、上方 20cm。

### 浏览器有视频但对讲没声音

1. 看 `/api/media/status`。
2. 看 talkback forward 是否 active。
3. 看 Jetson `5006` 是否有 UDP listener。
4. 看 `audio-playback.log`。
5. 查 `aplay -l` 和配置中的 `audio_playback_device`。
6. 如果设备 busy，找占用声卡的进程。

### rosbridge 云端断连

1. 查云服务器 `19090` 端口。
2. 查 Jetson 反向隧道服务。
3. 查 Jetson `usb0` / 流量卡是否重枚举。
4. 参考 `doc/rosbridge_disconnect_root_cause_2026-05-01.md`。

## 14. 维护注意事项

- 每次改功能后建议 commit。
- 改 Jetson ROS 节点：
  - 改 `jetson_mirror`。
  - 同步到 Jetson。
  - `colcon build --packages-select jetson_node_pkg --symlink-install`。
  - 重启 system_manager。

- 改前端：
  - `bun run --filter client build`。
  - 部署 `packages/client/dist`。

- 改后端：
  - `bun run --filter server build`。
  - 同步到云服务器 `/opt/webbot/packages/server`。
  - 重启 `webbot-server`。

- 改媒体配置：
  - 优先通过前端设置面板或 `/api/settings`。
  - 再调用 `/api/settings/apply-jetson` 下发到 Jetson。

- 地图文件真实来源：
  - Jetson `/home/nvidia/maps`。
  - 云端只缓存地图列表，不应作为地图本体来源。

- ROS graph 很多 topic 只在导航/建图启动后存在。
  - 空闲时看不到 `/map`、`/scan`、`/navigate_to_pose` 是正常的。

- 导航问题不要只看前端。
  - 必须同时看 Nav2 日志、TF、scan、map、CPU/mem。

## 15. 推荐接手路线

1. 先跑通本地前端：
   - `bun run dev:local`
   - 看 `/api/config` 和 rosbridge 面板。

2. 再确认 Jetson 常驻服务：
   - `webbot-rosbridge.service`
   - `webbot-system-manager.service`
   - `ROS_DOMAIN_ID=1 ros2 node list`

3. 再看地图链路：
   - `/system/map_list`
   - `/system/request_static_map`
   - `/system/static_map`

4. 再看导航链路：
   - `/system/start_nav`
   - Nav2 bringup 日志。
   - `/map`、`/scan`、`/tf`。

5. 最后看媒体链路：
   - `/api/media/status`
   - Janus。
   - GStreamer。
   - 声卡和摄像头设备。
