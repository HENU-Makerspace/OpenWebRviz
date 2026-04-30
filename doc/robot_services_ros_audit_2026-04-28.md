# 机器人侧 Service / ROS 包联动审计

审计时间：2026-04-28

目标机器人：`nvidia@192.168.1.58`

审计方式：只读 SSH 登录机器人，读取 systemd unit、启动脚本、ROS workspace、接口定义、运行时 ROS graph、Janus/媒体配置和近期日志。未在机器人上执行启动/停止/写文件操作。

## 1. 总体链路

前端不是直接控制硬件，而是经由 rosbridge 和机器人侧 ROS/service 节点闭环：

```text
浏览器 React
  -> 后端 /api/config 获取 rosbridgeUrl
  -> rosbridge WebSocket :9090
  -> ROS service/action/topic
  -> jetson_node_pkg / Nav2 / FAST-LIO / Diablo 底盘 / Janus
```

当前机器人空闲状态下的 ROS 运行节点：

- `/rosbridge_websocket`
- `/rosapi`
- `/system_manager_node`
- `/diablo_ctrl_node`

当前空闲状态下前端可用的关键 ROS 服务：

- `/system/start_slam` (`std_srvs/srv/Trigger`)
- `/system/start_nav` (`jetson_interfaces/srv/StartNav`)
- `/system/stop_all` (`std_srvs/srv/Trigger`)
- `/system/save_map` (`std_srvs/srv/Trigger`)
- `/system/status` (`std_srvs/srv/Trigger`)

当前空闲状态下关键 topic：

- `/diablo/MotionCmd` (`motion_msgs/msg/MotionCtrl`)
- `/diablo/sensor/*`

注意：`/navigate_to_pose`、`/navigate_through_poses`、`/map`、`/scan` 等 Nav2/SLAM 相关接口在空闲状态下不会出现，只有前端启动 SLAM 或导航后才由对应 launch 拉起。

## 2. 自启动服务

### 2.1 系统级服务：`jetson-ros-startup.service`

路径：

```text
/etc/systemd/system/jetson-ros-startup.service
```

状态：enabled / active。

内容摘要：

```ini
User=nvidia
WorkingDirectory=/home/nvidia
ExecStart=/bin/bash /home/nvidia/start_ros_services.sh
Restart=always
RestartSec=5
```

实际启动脚本：

```bash
source /home/nvidia/ros2_ws/install/setup.bash
export ROS_DOMAIN_ID=1
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp

nohup ros2 launch rosbridge_server rosbridge_websocket_launch.xml > /home/nvidia/rosbridge.log 2>&1 &
sleep 3

nohup ros2 launch jetson_node_pkg system_manager.launch.py > /home/nvidia/sys_man.log 2>&1 &
wait
```

作用：

- 开机启动 rosbridge。
- 开机启动 `jetson_node_pkg/system_manager.launch.py`，从而暴露 `/system/*` 服务给前端。

潜在问题：

- unit 描述写的是 “Start ROS bridge and MQTT client on boot”，但脚本实际没有启动 MQTT client；MQTT 只在导航 launch 里启动。
- `ROS_DOMAIN_ID=1` 只在这个脚本里设置。`system_manager_node.py` 后续 `subprocess.Popen` 会继承该环境，所以当前链路可用；但如果手动用别的方式启动 system_manager，子 launch 可能进错 ROS domain。
- rosbridge 使用默认参数，日志明确提示：
  - `default_call_service_timeout = 0.0`：service call 可能无限阻塞。
  - `call_services_in_new_thread = False`：service call 会阻塞 rosbridge 主线程。
  - `send_action_goals_in_new_thread = False`：action goal 发送会阻塞主线程。
- 前端所有 `/system/*` 服务、Nav2 action 都经 rosbridge，因此这些默认值会影响 UI 卡顿和超时恢复。

建议：

- 给 rosbridge launch 增加参数：service timeout、service/action new thread。
- 在文档中明确 `ROS_DOMAIN_ID=1` 是机器人运行前提。
- 修正 unit 描述，避免误以为 MQTT 已常驻。

### 2.2 用户级服务：`webbot-*`

路径：

```text
/home/nvidia/.config/systemd/user/
```

当前状态：

- `webbot-media.service`：enabled / active
- `webbot-media-control.service`：enabled / active
- `webbot-face.service`：enabled / active
- `webbot-reverse-tunnel.service`：enabled / active
- `webbot-media-tunnel.service`：enabled / active
- `webbot-video.service`：disabled / inactive，按需启动

本仓库模板与机器人部署文件 hash 一致：

- `packages/server/systemd/webbot-media.sh` == `/home/nvidia/bin/webbot-media.sh`
- `packages/server/systemd/webbot-video.sh` == `/home/nvidia/bin/webbot-video.sh`
- `packages/server/systemd/webbot-media-control.py` == `/home/nvidia/bin/webbot-media-control.py`
- `packages/server/systemd/webbot-face-service.py` == `/home/nvidia/bin/webbot-face-service.py`
- `packages/server/systemd/webbot-*.service` == `/home/nvidia/.config/systemd/user/webbot-*.service`

#### `webbot-media.service`

启动：

```ini
ExecStartPre=%h/bin/webbot-media.sh cleanup-only
ExecStart=%h/bin/webbot-media.sh
ExecStopPost=%h/bin/webbot-media.sh cleanup-only
Restart=always
```

脚本做的事：

- 启动 Janus：`/opt/janus/bin/janus`
- 启动 Janus demo HTTP：`python3 -m http.server 8000 --directory /opt/janus/share/janus/html`
- 尝试启动麦克风采集 GStreamer 到 UDP 5005。
- 尝试启动扬声器回放 GStreamer，从 UDP 5006 播放。

当前日志显示：

```text
Skipping audio-capture: ALSA capture device plughw:CARD=UACDemoV10,DEV=0 is unavailable
Skipping audio-playback: ALSA playback device plughw:CARD=UACDemoV10,DEV=0 is unavailable
```

当前 `arecord -l` / `aplay -l` 没有 `UACDemoV10`，只有 Jetson APE/HDA 设备。因此：

- 前端“监听机器人声音”即使 Janus stream id 99 存在，也可能没有实际音频 RTP 输入。
- 前端“对讲”即使 audiobridge forwarder 启动，机器人本地没有 audio-playback pipeline，扬声器可能不出声。

建议：

- 前端 `/api/media/status` 或 robot media control 增加 audio capture/playback pipeline 状态。
- 配置中不要固定 `plughw:CARD=UACDemoV10,DEV=0`，改为可从 `/api/config` 或部署环境显式设置。
- 对讲按钮在 audio playback 不可用时应显示明确不可用。

#### `webbot-video.service`

启动：

```ini
ExecStartPre=%h/bin/webbot-video.sh cleanup-only
ExecStart=%h/bin/webbot-video.sh
Restart=on-failure
```

GStreamer 管线：

```text
v4l2src /dev/video0 MJPG 1280x720@30
  -> jpegdec
  -> nvvideoconvert
  -> tee
     -> x264enc -> rtph264pay pt=96 -> udpsink 127.0.0.1:8004
     -> videorate 6fps -> jpegenc -> frame-%05d.jpg max-files=4
```

当前摄像头能力：

- `/dev/video0` 存在。
- 支持 MJPG `1280x720@30`。

结论：视频输入参数与摄像头能力匹配。视频服务 inactive 属正常按需状态。

潜在问题：

- 管线依赖 `nvvideoconvert` 和 Jetson GStreamer 插件，不能直接移植到普通 x86。
- `media-control` 的 `/video/start` 要求 frame dir 有 JPEG 才算成功；如果 H264 分支正常但 JPEG 分支坏了，前端会认为视频启动失败。

#### `webbot-media-control.service`

监听：

```text
127.0.0.1:19110
```

接口：

- `GET /status`
- `POST /video/start`
- `POST /video/stop`

当前状态快照：

```json
{
  "video": {
    "active": false,
    "activeState": "inactive",
    "frameCount": 0,
    "deviceExists": true
  },
  "media": {
    "active": true,
    "activeState": "active"
  }
}
```

前端链路：

```text
MediaViewport 打开视频
  -> useRobotMedia.startVideo()
  -> 后端 /api/media/video/start
  -> 云端/本地代理到 127.0.0.1:19110/video/start
  -> systemctl --user start webbot-video.service
```

潜在问题：

- 只控制 video，不控制 audio capture/playback；但 UI 上媒体状态容易被理解为整体媒体健康。
- `webbot-media.service` 是 Requires，基础媒体挂掉时 control API 也会停，前端只得到代理失败。

#### `webbot-face.service`

监听：

```text
127.0.0.1:19100
```

接口：

- `GET /health`
- `GET /faces/latest`

当前 health：

```json
{
  "online": false,
  "updatedAt": null,
  "identitiesLoaded": 2,
  "lastError": "No readable frames found in /home/nvidia/.local/state/webbot-media/frames",
  "device": "/dev/video0"
}
```

判断：当前 video service inactive，frame dir 为空，所以 face offline 合理，不一定是 bug。

前端链路：

```text
视频连接成功
  -> useFaceRecognition active
  -> /api/face/latest
  -> cloud tunnel 19100
  -> webbot-face-service.py /faces/latest
  -> MediaViewport 画 bbox
```

潜在问题：

- 只有前端视频 connected 时才轮询；如果只想诊断 face service，UI 默认不会展示。
- 如果视频 H264 分支正常但 JPEG frame 分支异常，人脸永远 offline。

#### `webbot-reverse-tunnel.service`

作用：

```text
云服务器 127.0.0.1:19090 -> 机器人 127.0.0.1:9090 rosbridge
```

前端 cloud 配置：

```text
wss://qiuhua.ying-guang.com/rosbridge/
  -> nginx
  -> 127.0.0.1:19090
  -> SSH reverse tunnel
  -> robot rosbridge :9090
```

#### `webbot-media-tunnel.service`

作用：

```text
云 127.0.0.1:18088 -> robot Janus HTTP 8088
云 127.0.0.1:18000 -> robot Janus demo 8000
云 127.0.0.1:19100 -> robot face service 19100
云 127.0.0.1:19110 -> robot media control 19110
```

潜在问题：

- 两个 tunnel service 都硬编码 `root@182.43.86.126`。
- 如果云服务器旧 SSH 会话残留占端口，新隧道会失败；云端 sshd keepalive 配置已经部分缓解。

## 3. ROS 包与前端指令映射

### 3.1 `jetson_interfaces`

接口：

```text
srv/StartNav.srv

string map_yaml_file
string stance
string speed
---
bool success
string message
```

前端调用：

```text
NavigationPanel.startNavigation()
  -> useSystemManager.startNavigation(mapYamlPath, stance, speed)
  -> /system/start_nav
```

注意：`StartNav.srv` 没有 `nav2_params_file` 字段，但 `system_manager_node.py` 里有 `getattr(request, 'nav2_params_file', ...)`，这是死代码。

### 3.2 `motion_msgs`

关键消息：

```text
motion_msgs/msg/MotionCtrl

bool mode_mark
MovementCtrlData value
MovementCtrlMode mode

MovementCtrlData:
  float64 forward
  float64 left
  float64 up
  float64 roll
  float64 pitch
  float64 leg_split

MovementCtrlMode:
  bool pitch_ctrl_mode
  bool roll_ctrl_mode
  bool height_ctrl_mode
  bool stand_mode
  bool jump_mode
  bool split_mode
```

前端遥控链路：

```text
键盘 W/A/S/D
  -> useKeyboardTeleop
  -> publish /diablo/MotionCmd
  -> /diablo_ctrl_node
  -> 底盘
```

导航链路：

```text
Nav2 controller_server
  -> /cmd_vel geometry_msgs/Twist
  -> cmd_vel_converter 或 stand_cmd_vel_converter
  -> /diablo/MotionCmd
  -> /diablo_ctrl_node
```

### 3.3 `jetson_node_pkg/system_manager_node.py`

本仓库 `packages/server/src/system_manager_node.py` 与机器人源码 hash 一致。

暴露服务：

- `/system/start_slam`
- `/system/start_nav`
- `/system/stop_all`
- `/system/save_map`
- `/system/status`

#### `/system/start_slam`

前端：

```text
启动 SLAM
  -> /system/start_slam
```

机器人：

```text
ros2 launch jetson_node_pkg mapping_all.launch.py
```

`mapping_all.launch.py` 启动：

- Livox MID360 driver
- FAST-LIO mapping
- `body -> base_link` static TF
- `base_link -> camera_link` static TF
- `pointcloud_to_laserscan`：`/cloud_registered_body` -> `/scan`
- `slam_toolbox` async node，参数 `/home/nvidia/ros2_ws/my_slam.yaml`

#### `/system/start_nav`

前端：

```text
选择地图 map_xxx
选择姿态 crouch/stand
选择速度 high/medium/low
  -> /system/start_nav
     map_yaml_file=/home/nvidia/maps/map_xxx.yaml
     stance=...
     speed=...
```

机器人：

- `stance == stand` -> `ros2 launch jetson_node_pkg stand_nav_launch.py`
- 其他 -> `ros2 launch jetson_node_pkg nav_all.launch.py`

两个导航 launch 都启动：

- Livox MID360 driver
- FAST-LIO
- TF
- `pointcloud_to_laserscan`
- MQTT client
- cmd_vel converter
- 10 秒后 Nav2 bringup

#### `/system/save_map`

前端：

```text
保存地图
  -> /system/save_map
```

机器人：

```text
ros2 run nav2_map_server map_saver_cli \
  -f /home/nvidia/maps/map_<timestamp> \
  --ros-args \
  -p save_map_timeout:=10.0 \
  -p map_subscribe_transient_local:=true
```

成功后上传：

```text
http://182.43.86.126:4001/api/maps/upload
```

风险：上传失败只写 warn，服务仍返回 success，前端可能误以为云端保存成功。

#### `/system/stop_all`

前端：

```text
停止 SLAM / 停止导航
  -> /system/stop_all
```

机器人：

- 先发布 3 次 `/diablo/MotionCmd` 零速度。
- kill 当前由 system_manager 启动的 process group。
- 再发布 3 次零速度。

风险：fallback `pkill` 范围和遗漏见问题清单。

## 4. 机器人 ROS launch 文件

### `mapping_all.launch.py`

用途：建图。

关键 topic/frame：

- `/cloud_registered_body` -> `/scan`
- TF：`body -> base_link`
- TF：`base_link -> camera_link`
- `slam_toolbox` 使用 `/home/nvidia/ros2_ws/my_slam.yaml`

潜在问题：

- `static_transform_publisher` 与旧 `continuous_tf_pub.py` 有重复功能，当前 launch 使用 static 版本。
- `my_slam.yaml` 里 frame 为 `camera_init/map/base_link`，前端 TF 解析需要 map 到 base_link 的链路完整。

### `nav_all.launch.py`

用途：蹲姿/趴姿导航。

关键节点：

- Livox
- FAST-LIO
- static TF
- pointcloud_to_laserscan
- mqtt_client
- `cmd_vel_converter`
- 10 秒后 Nav2 bringup

速度参数设计：

```python
speed_params = {
  'high': '/home/nvidia/ros2_ws/my_nav2_params.yaml',
  'medium': '/home/nvidia/ros2_ws/my_nav2_params_medium.yaml',
  'low': '/home/nvidia/ros2_ws/my_nav2_params_low.yaml',
}
```

但是实际被 `system_manager_node.py` 覆盖，见高优先级问题 5.1。

### `stand_nav_launch.py`

用途：站立导航。

关键节点：

- Livox
- FAST-LIO
- static TF，`body -> base_link` 的 z 为 `-0.35`
- pointcloud_to_laserscan，`min_height=-0.25`，`max_height=1.5`
- `stand_cmd_vel_converter`
- 10 秒后 Nav2 bringup
- mqtt_client

速度参数设计：

```python
speed_params = {
  'high': '/home/nvidia/ros2_ws/stand_nav2_params_high.yaml',
  'medium': '/home/nvidia/ros2_ws/stand_nav2_params_medium.yaml',
  'low': '/home/nvidia/ros2_ws/stand_nav2_params_low.yaml',
}
```

但是实际也被 `system_manager_node.py` 覆盖，见高优先级问题 5.1。

### `mapping_nav_launch.py`

用途：边建图边导航实验 launch。

状态：当前 `system_manager_node.py` 不调用它。

### `stand_down_nav_launch.py`

用途：旧的固定地图/固定参数趴姿导航。

状态：当前 `system_manager_node.py` 不调用它。

### `sensors_tf.launch.py`

用途：旧传感器 TF 和点云切片。

状态：当前主链路未使用。

## 5. 高优先级问题

### 5.1 前端速度档位在机器人侧实际被忽略

证据：

前端会向 `/system/start_nav` 发送：

```text
stance = stand|crouch
speed = high|medium|low
```

机器人 `nav_all.launch.py` 和 `stand_nav_launch.py` 都有 `speed_params`，本来可以按 speed 选择不同 Nav2 参数文件。

但 `system_manager_node.py` 总是构造：

```python
nav2_params_file = getattr(request, 'nav2_params_file', self.nav2_params_file)
...
ros_args = [
  ...,
  f'params_file:={nav2_params_file}',
  f'speed:={speed}',
]
```

而 `StartNav.srv` 没有 `nav2_params_file` 字段，所以 `nav2_params_file` 永远是默认：

```text
/home/nvidia/ros2_ws/my_nav2_params.yaml
```

launch 里的 `_resolve_params_file()` 逻辑是：只要 explicit `params_file` 非空，就直接使用 explicit 文件，不再看 `speed`。

影响：

- 前端选 `medium/low` 仍使用 high 参数。
- 前端选 `stand` 时也传入 crouch high 参数 `/home/nvidia/ros2_ws/my_nav2_params.yaml`，导致 stand 专用 `stand_nav2_params_*.yaml` 不生效。
- UI 显示“站立/高速/中速/低速”会误导操作者。

建议修复：

- 最简单：`system_manager_node.py` 不再传 `params_file:=...`，只传 `speed:=...`，让 launch 自己选择。
- 或扩展 `StartNav.srv` 加 `nav2_params_file` 字段，并前端显式传对应姿态/速度的参数文件。
- 修复后在日志中打印最终 `params_file`，便于现场确认。

### 5.2 `cmd_vel_converter` 持续发布最后一次速度，`stop_guard` 未被启动

证据：

`cmd_vel_converter.py`：

- 订阅 `/cmd_vel` 后只保存 `current_forward/current_left`。
- 25Hz 定时器持续发布 `/diablo/MotionCmd`。
- 如果 `/cmd_vel` 停止发布，它不会自动清零。

`stand_cmd_vel_converter.py` 同理。

`stop_guard.py` 看起来是为“cmd_vel 超时自动停”写的，但：

- `nav_all.launch.py` 未启动 `stop_guard`。
- `stand_nav_launch.py` 未启动 `stop_guard`。

影响：

- 如果 Nav2 异常、rosbridge/action 失败、controller 停止发布且没有先发零速度，converter 可能继续把最后一次速度发给底盘。
- `/system/stop_all` 会发零速度，但它需要用户或前端主动触发；不能覆盖所有异常路径。

建议修复：

- 在 converter 内加入 `/cmd_vel` 超时逻辑，例如 0.3-0.5 秒无新消息则 `current_forward/current_left=0`。
- 或把 `stop_guard` 纳入 `nav_all.launch.py` 和 `stand_nav_launch.py`。
- stand/crouch 的 stop 高度需要匹配当前姿态，不能固定 `stand_mode=True/up=1.0`。

### 5.3 rosbridge 当前 service/action 调用可能阻塞主线程

证据：

`/home/nvidia/rosbridge.log`：

```text
default_call_service_timeout = 0.0
call_services_in_new_thread = False
send_action_goals_in_new_thread = False
```

影响：

- 前端点击启动 SLAM/导航/保存地图时，如果 service 长时间不返回，rosbridge 可能阻塞。
- action 目标发送也可能影响 rosbridge 对其他消息的处理。

建议修复：

- 自定义 rosbridge launch 参数：
  - `default_call_service_timeout: 10.0`
  - `call_services_in_new_thread: true`
  - `send_action_goals_in_new_thread: true`
- 前端也保留自己的超时和错误展示。

### 5.4 音频设备配置与当前机器人硬件不匹配

证据：

配置期望：

```text
plughw:CARD=UACDemoV10,DEV=0
```

当前 `arecord -l` / `aplay -l` 没有 `UACDemoV10`。

日志持续出现：

```text
Skipping audio-capture...
Skipping audio-playback...
```

影响：

- Janus mountpoint `id=99` 存在，但没有麦克风 RTP 输入。
- Talkback forwarder 可创建，但本机没有 UDP 5006 -> ALSA playback pipeline，机器人可能不出声。

建议修复：

- 更新音频设备配置，或在未插 USB 声卡时隐藏/禁用音频功能。
- `/api/media/status` 应返回 audio capture/playback 是否实际运行。

### 5.5 保存地图“本地成功但上传失败”仍返回成功

证据：

`system_manager_node.py` 上传失败只 `warn`，随后仍：

```python
response.success = True
response.message = f'Map saved: {yaml_path}'
```

影响：

- 前端地图列表来自云服务器 `/api/maps`。
- 如果上传失败，机器人本地有地图，云端没有地图，前端仍可能表现为保存完成。

建议修复：

- 返回结构区分：
  - local_saved
  - upload_success
  - upload_error
- 前端保存后轮询云端地图列表，找不到时提示“机器人本地已保存但云端上传失败”。

## 6. 中优先级问题

### 6.1 导航 fallback kill 漏掉部分子节点

`system_manager_node.py` 优先 kill process group，这通常能杀掉 launch 子进程。

但 fallback 对 navigation 只 `pkill`：

- `nav2_bringup`
- `navigation_launch`
- `robot_state_publisher`
- `gz sim`

而实际 `nav_all.launch.py` 还启动：

- Livox driver
- FAST-LIO
- `pointcloud_to_laserscan`
- `mqtt_client`
- `cmd_vel_converter` / `stand_cmd_vel_converter`

如果 process group kill 失败或 system_manager 重启丢失 `current_process`，这些节点可能残留。

建议：

- fallback 增加 `fastlio_mapping`、`livox_ros_driver2_node`、`pointcloud_to_laserscan`、`mqtt_client`、`cmd_vel_converter`。
- 更好的方案是使用 ROS lifecycle 或 launch pid/state 管理，不依赖 `pkill -f`。

### 6.2 `/system/status` 只知道 system_manager 本次启动的进程

如果导航/SLAM 是手动启动，或者 system_manager 重启后旧进程残留：

- `current_process` 为空。
- `/system/status` 返回 `idle|`。

前端会误以为机器人空闲。

建议：

- `/system/status` 同时检查关键节点/action/topic，例如 `slam_toolbox`、`bt_navigator`、`controller_server`、`map_server`。
- 或将 system_manager 做成唯一入口，并启动前清理所有相关残留。

### 6.3 前端选择的云端地图不保证机器人本地存在

前端导航地图列表来自云服务器 `/api/maps`，启动导航时却构造：

```text
/home/nvidia/maps/<selectedMap>.yaml
```

依赖假设：

- 云端地图一定来自这台机器人上传。
- 机器人本地 `/home/nvidia/maps` 仍有同名地图。

如果云端地图被手工上传、复制、或机器人本地文件被删，`/system/start_nav` 会失败。

建议：

- 启动导航前增加机器人侧 `/system/has_map` 或扩展 `/system/start_nav` 支持从云端拉取缺失地图。
- 前端显示错误：`map file not found`。

### 6.4 Janus streaming 默认样例仍保留

`janus.plugin.streaming.jcfg` 中除了真实：

- `jetson-audio id=99`
- `jetson-cam id=101`

还保留样例 mountpoint：

- id 1
- id 2
- id 3
- id 123

当前前端 preferred id 固定 99/101，所以通常没问题。但如果配置 preferred id 为 0，自动 pick 可能选到样例流。

建议：

- 生产配置删除或注释样例 mountpoint。
- 保留 preferred id，且未找到时给出明确错误。

### 6.5 `StartNav.srv` 与 system_manager 代码有漂移迹象

`system_manager_node.py` 试图读取 `request.nav2_params_file`，但 srv 无该字段。

影响：

- 当前不会 crash，因为用了 `getattr`。
- 但说明接口和实现曾经演进不一致，后续容易继续产生“前端以为传了，机器人没收到”的问题。

建议：

- 将 `/system/start_nav` 请求字段固定成文档和测试。
- 如果要支持更多参数，先改 srv，再更新前端和 robot install。

## 7. 前端到机器人接口对照表

| 前端功能 | 前端代码 | ROS/HTTP 接口 | 机器人侧实现 | 当前风险 |
|---|---|---|---|---|
 连接机器人 | `useRosConnection` | rosbridge `:9090` / cloud `/rosbridge/` | `jetson-ros-startup.service` 启动 rosbridge | rosbridge service/action 可能阻塞 |
 遥控移动 | `useKeyboardTeleop` | publish `/diablo/MotionCmd` | `/diablo_ctrl_node` | 直接绕过 converter，消息语义需保持一致 |
 启动 SLAM | `useSystemManager.startSlam` | `/system/start_slam` | `mapping_all.launch.py` | 启动失败 UI 展示不足 |
 停止 SLAM/导航 | `useSystemManager.stopAll` | `/system/stop_all` | kill process group + 零速度 | fallback kill 漏节点 |
 保存地图 | `useSystemManager.saveMap` | `/system/save_map` | `map_saver_cli` + upload cloud | 上传失败仍 success |
 启动导航 | `useSystemManager.startNavigation` | `/system/start_nav` | `nav_all` / `stand_nav` | speed/stand params 被覆盖 |
 单点目标 | `useNavigationTasks.startSingleGoal` | `/navigate_to_pose` action | Nav2 bringup 后提供 | idle 状态不存在；action 状态判断需核对 |
 多点/巡航 | `useNavigationTasks.startRoute/startLoop` | 多次 `/navigate_to_pose` | 前端串行 | 页面断开任务丢失 |
 地图显示 | `MapCanvas` | `/map` topic 或云端 `/api/maps` | SLAM/Nav2 map_server | 当前导航画布未真正使用 selectedMap |
 激光显示 | `MapCanvas` | `/scan` topic | pointcloud_to_laserscan | 只在 SLAM/Nav 启动后有 |
 视频 | `useRobotMedia.startVideo` | `/api/media/video/start` -> `19110` | `webbot-video.service` | JPEG 分支影响启动判断 |
 监听音频 | `useRobotMedia.startAudioMonitor` | Janus stream id 99 | `webbot-media.sh` audio-capture | 当前音频设备缺失 |
 对讲 | `useRobotMedia.startTalkback` | Janus audiobridge room 1234 + RTP forward 5006 | `webbot-media.sh` audio-playback | 当前音频设备缺失 |
 人脸框 | `useFaceRecognition` | `/api/face/latest` -> `19100` | `webbot-face.service` | 视频 inactive 时 offline 正常 |

## 8. 建议修复顺序

1. 修复 `/system/start_nav` 参数覆盖：不要默认传 `params_file`，让 `speed` 和 `stance` 生效。
2. 给 `cmd_vel_converter` / `stand_cmd_vel_converter` 加速度超时自动清零，或启动 `stop_guard`。
3. 调整 rosbridge launch 参数，避免 service/action 阻塞主线程。
4. 暴露音频采集/回放真实状态，并修正当前音频设备配置。
5. 修复地图保存上传结果语义，前端显示本地保存/云端上传的差异。
6. 扩展 `/system/status`，识别残留 Nav2/SLAM 节点。
7. 删除 Janus 样例 mountpoint 或确保前端永远使用固定 id 99/101。

## 9. 已验证事实

- 可免密登录 `nvidia@192.168.1.58`。
- 机器人 hostname 是 `nvidia-desktop`。
- 当前系统级 `jetson-ros-startup.service` active。
- 当前用户级 `webbot-media`、`webbot-media-control`、`webbot-face`、`webbot-reverse-tunnel`、`webbot-media-tunnel` active。
- 当前 `webbot-video` inactive，符合按需启动。
- 当前 ROS_DOMAIN_ID 为启动脚本设置的 `1`。
- 当前 rosbridge 暴露 `/system/*` 服务。
- 当前未启动 SLAM/Nav2，所以 `/navigate_to_pose` action 不存在是正常现象。
- 机器人本地 `/home/nvidia/maps` 有多份地图。
- 本仓库的 system_manager 和 webbot service/script 与机器人部署文件 hash 一致。
