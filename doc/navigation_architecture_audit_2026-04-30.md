# Jetson 导航实现审计与重构方案

审计时间：2026-04-30 22:05 CST

审计对象：

- Jetson：`nvidia@192.168.1.58`
- ROS 工作区：`/home/nvidia/ros2_ws`
- Livox 工作区：`/home/nvidia/livox_ws`
- 前端/后端仓库：`/home/c6h4o2/dev/web/ROS`

状态说明：

- 22:44 完成第一步：对齐 FastLIO2 frame 配置说明。
- 23:47 完成第二步：引入 `base_footprint`，并把 SLAM/Nav2/AMCL 的导航基准切到平面底盘 frame。
- 本文前半部分记录“当前 Jetson 真实配置”；后半部分保留早期审计发现，作为后续清理背景。

## 0. 已执行变更

### 2026-04-30 22:44，第一步：对齐 FastLIO2 frame 配置说明

已在 Jetson 上修改：

```text
/home/nvidia/ros2_ws/src/FAST_LIO/config/mid360.yaml
/home/nvidia/ros2_ws/install/fast_lio/share/fast_lio/config/mid360.yaml
```

变更：

```diff
- map_frame: "odom"
- body_frame: "base_link"
+ # Keep these labels aligned with this FAST_LIO fork's runtime output.
+ # laserMapping.cpp currently publishes /Odometry and TF as camera_init -> body.
+ map_frame: "camera_init"
+ body_frame: "body"
```

这一步不改 Nav2、AMCL、slam_toolbox、TF launch，不改变当前实际运行 TF 链，只消除 FastLIO2 YAML 与源码硬编码输出之间的表述不一致。

执行前已备份原文件：

```text
/home/nvidia/ros2_ws/src/FAST_LIO/config/mid360.yaml.bak_step1_20260430_224427
/home/nvidia/ros2_ws/install/fast_lio/share/fast_lio/config/mid360.yaml.bak_step1_20260430_224427
```

验证结果：

- source 与 install 两处 `mid360.yaml` 内容一致。
- YAML 可解析，`common.map_frame=camera_init`，`common.body_frame=body`。
- 修改时 Jetson 上没有运行 `fastlio_mapping`、`livox_ros_driver2_node`、`pointcloud_to_laserscan`、`slam_toolbox`、`amcl`、Nav2 相关子进程。

### 2026-04-30 23:47，第二步：引入 `base_footprint`

目标：

- Nav2、AMCL、slam_toolbox 不再直接使用带高度和 roll/pitch 的 `base_link`。
- 双足轮式机器人站立/蹲下产生的倾斜只保留在 `base_footprint -> base_link`，不污染 2D 导航。
- 保留当前已经能跑通的 FastLIO2 输出 frame：`camera_init -> body`，暂不大改成标准 `odom`，降低一次性改动风险。

新增节点：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/jetson_node_pkg/base_footprint_projector.py
```

节点职责：

1. 订阅 FastLIO2 的 `/Odometry`。
2. 按当前已知外参计算 `camera_init -> base_link`：
   - FastLIO2 `/Odometry` 表示 `camera_init -> body`。
   - 原先静态 `body -> base_link` 为 `x=0.05, y=0, z=-0.25/-0.35, yaw=180 deg`。
3. 将完整 `base_link` 位姿分解为：
   - `camera_init -> base_footprint`：只包含 x/y/yaw，z=0，roll/pitch=0。
   - `base_footprint -> base_link`：只包含高度和剩余 roll/pitch。

当前主链路 TF：

```text
map
└── camera_init
    ├── body                  # FastLIO2 内部/IMU 机身 frame
    └── base_footprint        # Nav2/AMCL/slam_toolbox 使用的 2D 底盘 frame
        └── base_link         # 带高度和倾斜的机身/传感器安装基准
            └── camera_link
```

注意：这一阶段仍使用 `camera_init` 作为 odom frame。后续是否统一重命名为标准 `odom`，应单独做一步，不能和 `base_footprint` 混在一起改。

修改文件：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/setup.py
/home/nvidia/ros2_ws/src/jetson_node_pkg/package.xml
/home/nvidia/ros2_ws/src/jetson_node_pkg/jetson_node_pkg/base_footprint_projector.py
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/mapping_all.launch.py
/home/nvidia/ros2_ws/my_slam.yaml
/home/nvidia/ros2_ws/my_nav2_params.yaml
/home/nvidia/ros2_ws/my_nav2_params_medium.yaml
/home/nvidia/ros2_ws/my_nav2_params_low.yaml
/home/nvidia/ros2_ws/stand_nav2_params.yaml
/home/nvidia/ros2_ws/stand_nav2_params_high.yaml
/home/nvidia/ros2_ws/stand_nav2_params_medium.yaml
/home/nvidia/ros2_ws/stand_nav2_params_low.yaml
```

关键配置从：

```yaml
base_frame: base_link
base_frame_id: "base_link"
robot_base_frame: base_link
```

改为：

```yaml
base_frame: base_footprint
base_frame_id: "base_footprint"
robot_base_frame: base_footprint
```

主 launch 从“静态发布 `body -> base_link`”改为“由 `base_footprint_projector` 动态发布”：

```text
nav_all.launch.py:
  camera_init -> base_footprint -> base_link
  base_link_z = -0.25

stand_nav_launch.py:
  camera_init -> base_footprint -> base_link
  base_link_z = -0.35

mapping_all.launch.py:
  camera_init -> base_footprint -> base_link
  base_link_z = -0.25
```

仍保留：

```text
base_link -> camera_link
pointcloud_to_laserscan target_frame = base_link
```

这样 `/scan` 仍按真实传感器/机身链路生成，而 Nav2/AMCL/slam_toolbox 用平面 `base_footprint` 做 2D 位姿。

构建验证：

```bash
export ROS_DOMAIN_ID=1
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
source /opt/ros/humble/setup.bash
cd /home/nvidia/ros2_ws
colcon build --symlink-install --packages-select jetson_node_pkg
```

结果：

```text
Summary: 1 package finished
```

实测验证：

- `ros2 launch jetson_node_pkg nav_all.launch.py --show-args` 通过。
- `ros2 launch jetson_node_pkg stand_nav_launch.py --show-args` 通过。
- `ros2 launch jetson_node_pkg mapping_all.launch.py --show-args` 通过。
- 手动启动 `mapping_all.launch.py` 后，日志中只剩 `base_link_to_camera_link` 静态 TF，不再启动 `body_to_base_link`。
- `base_footprint_projector` 正常启动：

```text
Publishing planar TF camera_init -> base_footprint and tilted TF base_footprint -> base_link from /Odometry with body->base_link offset (0.05, 0.0, -0.25)
```

TF 实测：

```text
camera_init -> base_footprint:
  z = 0
  roll/pitch = 0
  yaw ~= +/-180 deg

base_footprint -> base_link:
  x/y = 0
  z ~= -0.32 m 实测随姿态轻微变化
  roll/pitch ~= 1 deg 以内
  yaw ~= 0
```

频率实测：

```text
/scan     ~= 10 Hz
/Odometry ~= 10 Hz
```

slam_toolbox 实测参数：

```text
base_frame = base_footprint
odom_frame = camera_init
map_frame  = map
```

新拓扑启动后的最新日志未再出现：

```text
Failed to compute odom pose
Timed out waiting for transform
Invalid frame
Lookup would require extrapolation
```

备份文件：

```text
/home/nvidia/ros2_ws/install/fast_lio/share/fast_lio/config/mid360.yaml.bak_step1_20260430_224427
/home/nvidia/ros2_ws/src/FAST_LIO/config/mid360.yaml.bak_step1_20260430_224427
/home/nvidia/ros2_ws/my_nav2_params.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/my_nav2_params_low.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/my_nav2_params_medium.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/my_slam.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/mapping_all.launch.py.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/src/jetson_node_pkg/setup.py.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/stand_nav2_params_high.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/stand_nav2_params_low.yaml.bak_base_footprint_20260430_230938
/home/nvidia/ros2_ws/stand_nav2_params_medium.yaml.bak_base_footprint_20260430_230938
```

遗留风险：

- 旧 launch 文件 `mapping_nav_launch.py`、`stand_down_nav_launch.py` 仍有历史 `base_link` 配置。从当前 `system_manager_node.py` 入口看主流程不用它们，后续应单独删除或统一改造。
- 当前仍使用 `camera_init` 作为 odom frame，这是为了兼容 FastLIO2 源码硬编码输出。标准化为 `odom` 是下一步，不应和本次改动混合。
- `/scan` 的 frame 仍为 `base_link`，这是有意保留。只要 TF 中 `base_footprint -> base_link` 稳定，slam_toolbox/AMCL 可以把 scan 转到 `base_footprint`。

## 1. 当前启动链路

### 1.1 systemd 自启动

系统级正在运行的 ROS 相关服务只有：

```text
/etc/systemd/system/jetson-ros-startup.service
```

服务内容：

```ini
[Service]
Type=simple
User=nvidia
WorkingDirectory=/home/nvidia
ExecStart=/bin/bash /home/nvidia/start_ros_services.sh
Restart=always
RestartSec=5
Environment=HOME=/home/nvidia
```

用户级正在运行的是媒体和反向隧道服务：

```text
webbot-media.service
webbot-media-control.service
webbot-media-tunnel.service
webbot-reverse-tunnel.service
```

它们不直接启动 Nav2/SLAM，只负责 Janus/视频/SSH 反向隧道。

### 1.2 `/home/nvidia/start_ros_services.sh`

当前脚本：

```bash
source /home/nvidia/ros2_ws/install/setup.bash
export ROS_DOMAIN_ID=1
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp

nohup ros2 launch rosbridge_server rosbridge_websocket_launch.xml > /home/nvidia/rosbridge.log 2>&1 &
sleep 3

nohup ros2 launch jetson_node_pkg system_manager.launch.py > /home/nvidia/sys_man.log 2>&1 &
wait
```

也就是说，开机常驻只有两类节点：

- `rosbridge_websocket`
- `system_manager_node`

审计时 ROS graph 也只看到基础话题：

```text
/parameter_events
/rosout
```

导航、SLAM、Livox、FastLIO、AMCL、Nav2 都不是常驻，而是由前端通过 rosbridge 调 Jetson 上的 `/system/start_*` 服务动态拉起。

### 1.3 前端到 Jetson 的调用链

前端：

- `packages/client/src/App.tsx`
- `packages/client/src/hooks/useSystemManager.ts`

前端调用：

```text
/system/start_slam  std_srvs/srv/Trigger
/system/start_nav   jetson_interfaces/srv/StartNav
/system/stop_all    std_srvs/srv/Trigger
/system/save_map    std_srvs/srv/Trigger
```

`StartNav.srv` 在 Jetson 上定义为：

```srv
string map_yaml_file
string stance
string speed
---
bool success
string message
```

前端传入：

- `map_yaml_file`
- `stance`: `stand` 或 `crouch`
- `speed`: `high` / `medium` / `low`

Jetson 的 `system_manager_node.py` 据此选择：

- `stance=crouch` -> `nav_all.launch.py`
- `stance=stand` -> `stand_nav_launch.py`

## 2. 当前 Jetson ROS 启动实现

### 2.1 `system_manager_node.py`

文件：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/jetson_node_pkg/system_manager_node.py
```

默认参数：

```text
slam_launch_file       = mapping_all.launch.py
nav_launch_file        = nav_all.launch.py
stand_nav_launch_file  = stand_nav_launch.py
maps_dir               = /home/nvidia/maps
server_url             = http://182.43.86.126:4001
```

动态启动 ROS 的 shell 会额外 source：

```bash
source /opt/ros/humble/setup.bash
source ~/livox_ws/install/setup.bash || true
source ~/ros2_ws/install/setup.bash || true
```

这点和 `start_ros_services.sh` 不同：常驻服务启动时只 source `ros2_ws`，而动态启动导航/SLAM 时才 source `livox_ws`。这解释了为什么空闲状态下 `ros2 pkg prefix livox_ros_driver2` 找不到，但导航/SLAM launch 中可以 Include Livox driver。

### 2.2 SLAM launch

文件：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/mapping_all.launch.py
```

启动内容：

1. `livox_ros_driver2/launch_ROS2/msg_MID360_launch.py`
2. `fast_lio/launch/mapping.launch.py`
3. `static_transform_publisher`: `body -> base_link`
4. `static_transform_publisher`: `base_link -> camera_link`
5. `pointcloud_to_laserscan`: `/cloud_registered_body` -> `/scan`
6. `slam_toolbox/async_slam_toolbox_node`

SLAM 参数：

```text
/home/nvidia/ros2_ws/my_slam.yaml
```

关键帧配置：

```yaml
odom_frame: camera_init
map_frame: map
base_frame: base_link
scan_topic: /scan
mode: mapping
use_odom: true
```

### 2.3 蹲姿导航 launch

文件：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py
```

启动内容：

1. Livox MID360 driver
2. FastLIO
3. `static_transform_publisher`: `body -> base_link`
4. `static_transform_publisher`: `base_link -> camera_link`
5. `pointcloud_to_laserscan`: `/cloud_registered_body` -> `/scan`
6. `mqtt_client`
7. `cmd_vel_converter`
8. 10 秒后启动 `nav2_bringup/bringup_launch.py`

速度参数选择：

```text
high   -> /home/nvidia/ros2_ws/my_nav2_params.yaml
medium -> /home/nvidia/ros2_ws/my_nav2_params_medium.yaml
low    -> /home/nvidia/ros2_ws/my_nav2_params_low.yaml
```

### 2.4 站姿导航 launch

文件：

```text
/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py
```

启动内容与蹲姿基本一致，但：

- `body -> base_link` 的 z 从 `-0.25` 改为 `-0.35`
- `base_link -> camera_link` 的 z 从 `0.15` 改为 `0.25`
- `pointcloud_to_laserscan` 的高度过滤改为 `min_height=-0.25, max_height=1.5`
- 控制桥改为 `stand_cmd_vel_converter`
- Nav2 参数改为 `stand_nav2_params_*`

速度参数选择：

```text
high   -> /home/nvidia/ros2_ws/stand_nav2_params_high.yaml
medium -> /home/nvidia/ros2_ws/stand_nav2_params_medium.yaml
low    -> /home/nvidia/ros2_ws/stand_nav2_params_low.yaml
```

### 2.5 FastLIO 当前配置

文件：

```text
/home/nvidia/ros2_ws/src/FAST_LIO/config/mid360.yaml
/home/nvidia/ros2_ws/install/fast_lio/share/fast_lio/config/mid360.yaml
```

源码和 install 中一致。关键配置：

```yaml
common:
  lid_topic: "/livox/lidar"
  imu_topic: "/livox/imu"
  map_frame: "odom"
  body_frame: "base_link"
preprocess:
  blind: 0.5
  scan_line: 4
publish:
  scan_publish_en: true
  dense_publish_en: true
  scan_bodyframe_pub_en: true
```

这和 Nav2/SLAM 参数里大量使用的 `camera_init` 不一致，是一个非常大的架构风险。

## 3. 关键问题

### 3.1 AMCL 和 FastLIO 的职责边界混乱

当前导航参数中，AMCL 配置为：

```yaml
global_frame_id: "map"
odom_frame_id: "camera_init"
base_frame_id: "base_link"
tf_broadcast: true
scan_topic: scan
```

Nav2 其他组件又同时使用：

```yaml
bt_navigator.global_frame: map
local_costmap.global_frame: camera_init
global_costmap.global_frame: map
behavior_server.global_frame: camera_init
velocity_smoother.odom_topic: /Odometry
```

但 FastLIO 当前配置是：

```yaml
map_frame: odom
body_frame: base_link
```

这意味着当前系统里至少有三套语义在混用：

- `map`: 2D 栅格地图全局坐标
- `camera_init`: 旧 FastLIO/SLAM 常见初始坐标名，但当前 FastLIO 配置已经是 `odom`
- `odom`: 当前 FastLIO 配置的局部里程计坐标

正确的 Nav2 架构必须只有一个清晰链路：

```text
map -> odom -> base_footprint -> base_link -> sensors
```

其中：

- `odom -> base_*` 由连续、平滑的局部里程计提供，可以来自 FastLIO 或 EKF。
- `map -> odom` 只能由一个全局定位源提供，通常是 AMCL 或 slam_toolbox localization。
- Nav2 不应该同时把 FastLIO 的 map/odom 概念和 AMCL 的 map/odom 概念混成一棵 TF 树。

### 3.2 当前 frame 名称会导致定位和 costmap 不稳定

如果 AMCL 真的发布 `map -> camera_init`，但 FastLIO 发布的是 `odom -> base_link`，则 Nav2 要么找不到完整 TF，要么依赖某些旧节点/残留 TF，表现会是：

- 导航刚启动时地图/机器人位姿偶尔对不上。
- 刷新前端后看到不同状态。
- `/scan` 在地图上有时对齐，有时中心对称或反向。
- local costmap 和 global costmap 对同一机器人位姿的理解不一致。

这类问题不是前端能彻底修掉的。前端渲染最多能避免旧数据残留，但底层 TF 树如果不唯一，Web/RViz 都会看到不稳定结果。

### 3.3 `body -> base_link` 被写成 180 度 yaw，风险极高

当前多个 launch 都发布：

```text
body -> base_link:
  x = 0.05
  z = -0.25 或 -0.35
  quaternion = (0, 0, 1, 0)
```

`qz=1, qw=0` 等价于 yaw 180 度。

这很可能是为了解决雷达背朝前安装的问题，但它把“传感器安装方向”和“机器人底盘前进方向”混在了 `body -> base_link` 里。后果是：

- FastLIO 的 body frame、机器人 base frame、雷达安装 frame 边界不清。
- `/cloud_registered_body` 再投影到 `base_link` 时可能被反转。
- AMCL 用 `/scan` 匹配 2D map 时可能出现中心对称或前后反的问题。
- 前端看到的 scan/map 对齐问题可能只是底层 TF 错误的外显。

正确做法不是反复调一个 `body -> base_link` 静态变换，而是明确：

```text
base_footprint
  -> base_link
  -> lidar_link / livox_frame
  -> camera_link
```

LiDAR 是否反装，应体现在 `base_link -> lidar_link` 的标定外参里，不应该让 `body` 这个 FastLIO 内部/IMU 语义 frame 直接冒充机器人底盘。

### 3.4 双足轮式机器人站立倾斜，不能用纯静态 TF 近似全部姿态

用户说明：机器人站起来会有一点倾斜，TF 不是完全固定。

当前实现把站姿和蹲姿差异只写成两个 z 值：

```text
crouch: body -> base_link z=-0.25
stand:  body -> base_link z=-0.35
```

这忽略了站立时的 pitch/roll。对 Nav2 来说，2D 导航最好使用投影到地面的 `base_footprint`，而不是带 pitch/roll 的 `base_link`：

```text
odom -> base_footprint   平面位姿，x/y/yaw
base_footprint -> base_link   高度 + roll/pitch，来自姿态/IMU/机器人状态
base_link -> lidar_link       固定安装外参
```

这样 Nav2、AMCL、costmap 看到的是稳定平面底盘；点云/雷达转换仍可以用真实姿态做高度过滤和投影。

### 3.5 SLAM 模式也在混合 FastLIO 和 slam_toolbox

`mapping_all.launch.py` 同时启动：

- FastLIO
- pointcloud_to_laserscan
- slam_toolbox

这本身可以成立，但必须定义清楚：

- FastLIO 只提供 `odom -> base_footprint/base_link` 的局部 odom。
- slam_toolbox 发布 `map -> odom`。
- slam_toolbox 的 `odom_frame` 必须和 FastLIO 的 odom frame 一致。

当前是：

```yaml
FastLIO map_frame: odom
slam_toolbox odom_frame: camera_init
```

这不一致。即使偶尔能跑，也是在依赖旧 frame 名称或隐式变换。

### 3.6 点云转 LaserScan 可能解释“前方只有一两米”

当前 LaserScan 来源：

```text
/cloud_registered_body -> pointcloud_to_laserscan -> /scan
target_frame: base_link
```

可能的问题：

- `body -> base_link` 180 度 yaw 写错或方向语义错，前后被翻转。
- 站立时机器人有 pitch，静态 TF 没有体现，导致前方地面/自身结构被高度过滤误判。
- `min_height/max_height` 用固定值，站姿/蹲姿只改 z，不改 pitch/roll，前方点云可能被切掉。
- MID360/FastLIO 的 `blind=0.5` 不是 1-2m 的主要原因；如果只有前方短而其他方向正常，更像 self-occlusion、安装方向或 TF/高度切片问题。
- 若雷达反装，应该在 `base_link -> lidar_link` 外参修正，而不是在 `body -> base_link` 上修正。

### 3.7 导航停止清理不完整

`kill_current_process()` 会杀 process group。正常情况下这会杀掉 launch 子进程。

但 fallback 针对 navigation 只 pkill：

```text
nav2_bringup
navigation_launch
robot_state_publisher
gz sim
```

没有覆盖：

```text
fastlio_mapping
livox_ros_driver2_node
pointcloud_to_laserscan
mqtt_client
cmd_vel_converter
stand_cmd_vel_converter
```

一旦 launch 父进程异常退出或有子进程脱离进程组，可能残留旧 TF、旧 scan、旧 cmd_vel converter。这会进一步放大“刷新几次才正常”“残留 SLAM 地图/TF”的问题。

### 3.8 工作区环境有残留/不完整迹象

直接 source 接口包时：

```bash
source /home/nvidia/ros2_ws/install/jetson_interfaces/share/jetson_interfaces/local_setup.bash
ros2 interface show jetson_interfaces/srv/StartNav
```

可以识别。

但 source 整个工作区：

```bash
source /home/nvidia/ros2_ws/install/setup.bash
ros2 pkg list | grep jetson
```

只显示 `jetson_node_pkg`，不显示 `jetson_interfaces`。Python import 仍能成功。

这说明当前 install overlay 至少有 ament index 或环境钩子不完整/顺序残留。它未必是当前导航失败主因，但会让 rosbridge service type、CLI 调试、后续部署变得不可靠。建议 clean rebuild 工作区。

## 4. 推荐的正确导航实现方案

### 4.1 总原则

只保留一棵 TF 树，职责如下：

```text
map
└── odom
    └── base_footprint
        └── base_link
            ├── lidar_link / livox_frame
            └── camera_link
```

职责分配：

- `odom -> base_footprint`：FastLIO 或 EKF 提供，连续、平滑、短期准确。
- `map -> odom`：AMCL 或 slam_toolbox localization 提供，低频全局校正。
- `base_footprint -> base_link`：机器人姿态/高度提供，包含站立/蹲下高度和 roll/pitch。
- `base_link -> lidar_link`：标定得到的固定外参，包含雷达是否反装。
- `base_link -> camera_link`：标定得到的固定外参。

不要再使用 `camera_init` 作为 Nav2 的 odom frame，除非整个系统明确统一为 `camera_init`。建议统一改为标准 `odom`。

### 4.2 建图模式

推荐链路：

```text
Livox MID360
  -> FastLIO
  -> odom -> base_footprint/base_link
  -> pointcloud_to_laserscan 或 2D 投影
  -> slam_toolbox
  -> map -> odom
  -> /map
```

建图模式中：

- 不启动 AMCL。
- FastLIO 不作为全局 map 权威，只作为 odom 来源。
- slam_toolbox 的参数应改为：

```yaml
odom_frame: odom
map_frame: map
base_frame: base_footprint
scan_topic: /scan
mode: mapping
use_odom: true
```

如果暂时不引入 `base_footprint`，最低限度也要把：

```yaml
odom_frame: camera_init
```

改到和 FastLIO 一致的 `odom`。

### 4.3 导航模式，2D 静态地图 + AMCL

推荐链路：

```text
map_server loads saved 2D map
FastLIO publishes odom -> base_footprint
AMCL consumes /scan + map and publishes map -> odom
Nav2 consumes map/odom/base_footprint and publishes /cmd_vel
cmd_vel_converter converts /cmd_vel -> /diablo/MotionCmd
```

Nav2 参数建议：

```yaml
amcl:
  ros__parameters:
    global_frame_id: map
    odom_frame_id: odom
    base_frame_id: base_footprint
    tf_broadcast: true
    scan_topic: /scan

bt_navigator:
  ros__parameters:
    global_frame: map
    robot_base_frame: base_footprint
    odom_topic: /Odometry

local_costmap:
  local_costmap:
    ros__parameters:
      global_frame: odom
      robot_base_frame: base_footprint
      rolling_window: true

global_costmap:
  global_costmap:
    ros__parameters:
      global_frame: map
      robot_base_frame: base_footprint

behavior_server:
  ros__parameters:
    global_frame: odom
    robot_base_frame: base_footprint

velocity_smoother:
  ros__parameters:
    odom_topic: /Odometry
```

注意：如果 `/Odometry` 的 child frame 仍是 `base_link`，要么调整 FastLIO/转换节点输出到 `base_footprint`，要么加一个稳定的投影节点，不要让 Nav2 直接跟着带 pitch/roll 的 base_link 做 2D 导航。

### 4.4 导航模式，FastLIO/3D 地图定位方案

如果室外/大尺度环境中 2D AMCL 不稳定，可以考虑不用 AMCL，而改为：

```text
FastLIO localization against prebuilt PCD/submap
  -> publishes map -> base_link or map -> odom + odom -> base_link
Nav2 uses projected 2D static/semantic map for planning
local costmap uses live pointcloud/scan for obstacles
```

但这需要 FastLIO 进入“重定位/定位”模式，而不是现在的实时 mapping 模式。当前配置和 launch 没有体现可靠的 PCD map localization 流程，所以短期不建议直接切这条路。

短期最稳方案仍是：

```text
FastLIO = odom
AMCL/slam_toolbox = map -> odom
Nav2 = 标准 2D 导航
```

### 4.5 双姿态 TF 与 footprint

建议新增明确的姿态模型：

```text
stance = crouch:
  footprint/radius 较小
  base_footprint -> base_link 高度较低
  点云高度过滤按蹲姿标定

stance = stand:
  footprint/radius 较大
  base_footprint -> base_link 高度较高
  base_link roll/pitch 来自 IMU 或机器人状态
  点云高度过滤按站姿标定
```

不要只用两个静态 z 值表示站立/蹲下。至少应把 roll/pitch 纳入 TF；更理想是从机器人状态或 IMU 发布动态 `base_footprint -> base_link`。

### 4.6 LaserScan 生成

建议重构为：

```text
cloud source: /cloud_registered 或 /cloud_registered_body，先确认真实 frame_id
target_frame: base_footprint 或 lidar/base frame 中经过验证的平面 frame
height filter: 按姿态单独标定
range_min/max: 与 AMCL/costmap 保持一致
```

调试时必须采集：

```bash
ros2 topic echo /cloud_registered_body --once
ros2 topic echo /scan --once
ros2 run tf2_ros tf2_echo odom base_link
ros2 run tf2_ros tf2_echo base_link livox_frame
ros2 run tf2_ros tf2_echo map odom
```

如果前方 scan 只有 1-2m，而侧后方正常，优先检查：

1. 雷达是否被机器人本体遮挡。
2. `base_link -> lidar_link` yaw 是否正确。
3. 点云转 scan 的 `target_frame` 是否正确。
4. 站立 pitch 是否导致前方地面被误切。
5. `min_height/max_height` 是否把前方有效点滤掉。

## 5. 建议落地步骤

### 第一步：冻结当前可运行版本，做最小验证

不要一上来大改全部参数。先用当前 launch 启动一次蹲姿导航，不发目标，只检查：

```bash
ros2 node list
ros2 topic list -t
ros2 topic echo /Odometry --once
ros2 topic echo /scan --once
ros2 run tf2_tools view_frames
ros2 run tf2_ros tf2_echo map base_link
ros2 run tf2_ros tf2_echo odom base_link
ros2 run tf2_ros tf2_echo camera_init base_link
```

要确认：

- `/Odometry.header.frame_id`
- `/Odometry.child_frame_id`
- `/scan.header.frame_id`
- 是否同时存在 `odom` 和 `camera_init`
- 是否有多个节点发布同一条 TF
- AMCL 是否发布 `map -> camera_init` 或 `map -> odom`

### 第二步：统一 frame 命名

短期先统一到：

```text
map -> odom -> base_link
```

中期再引入：

```text
map -> odom -> base_footprint -> base_link
```

需要改：

- `my_slam.yaml`
- `my_nav2_params*.yaml`
- `stand_nav2_params*.yaml`
- `mapping_all.launch.py`
- `nav_all.launch.py`
- `stand_nav_launch.py`
- FastLIO `mid360.yaml`

### 第三步：用 URDF/robot_state_publisher 或统一 TF 节点替代散落 static transforms

当前 `body -> base_link`、`base_link -> camera_link` 写在多个 launch 里，后续很容易改漏。

建议集中为：

```text
jetson_node_pkg/launch/robot_tf.launch.py
jetson_node_pkg/config/robot_frames.yaml
```

或直接使用 URDF/Xacro：

```text
base_footprint
base_link
livox_frame
camera_link
```

姿态高度和 pitch/roll 由一个节点按 `stance` 发布。

### 第四步：拆分 launch 职责

建议拆成：

```text
sensors.launch.py
  Livox driver
  FastLIO
  TF publisher
  pointcloud_to_laserscan

mapping.launch.py
  sensors.launch.py
  slam_toolbox

navigation_amcl.launch.py
  sensors.launch.py
  map_server + AMCL + Nav2
  cmd_vel_converter

navigation_fastlio_localization.launch.py
  保留为后续 3D 定位实验，不作为默认
```

不要在一个 launch 里同时承担“传感器、定位、地图、控制、MQTT、姿态”的所有职责。

### 第五步：启动前做 preflight，不用固定 `TimerAction(10s)`

当前 Nav2 延迟 10 秒启动。更稳的做法是 system_manager 启动导航时等待：

- `/livox/lidar` 有数据
- `/livox/imu` 有数据
- `/Odometry` 有数据
- `/scan` 有数据
- TF `odom -> base_*` 可查询
- 姿态转换完成

满足后再启动 Nav2 lifecycle。失败则返回明确错误给前端。

### 第六步：完善 stop/cleanup

`kill_current_process()` 的 navigation fallback 应补齐：

```text
fastlio_mapping
livox_ros_driver2_node
pointcloud_to_laserscan_node
pointcloud_to_laserscan
mqtt_client
cmd_vel_converter
stand_cmd_vel_converter
amcl
map_server
controller_server
planner_server
bt_navigator
behavior_server
velocity_smoother
waypoint_follower
```

并在停止导航后确认关键 topic/TF 消失，避免旧节点残留。

### 第七步：clean rebuild Jetson 工作区

建议在备份后执行：

```bash
cd /home/nvidia/ros2_ws
rm -rf build install log
source /opt/ros/humble/setup.bash
colcon build --symlink-install
source install/setup.bash
ros2 pkg list | grep jetson
ros2 interface show jetson_interfaces/srv/StartNav
```

目标是让 `jetson_interfaces` 在完整 workspace setup 后被 `ros2 pkg/interface` 正常识别。

## 6. 最小可行修复建议

如果要先快速修当前最大疏漏，建议按这个顺序：

1. 把所有 Nav2 和 slam_toolbox 参数里的 `camera_init` 统一改成 `odom`。
2. 确认 FastLIO 只发布 `odom -> base_link`，AMCL/slam_toolbox 只发布 `map -> odom`。
3. 暂时继续用 `base_link`，先不要马上引入 `base_footprint`，降低一次性改动风险。
4. 验证 `/scan.header.frame_id` 和 TF 后，再决定是否移除 `body -> base_link` 的 180 度 yaw。
5. 用实测标定重写 `base_link -> livox_frame`，把雷达反装修正在传感器外参，不放在 `body -> base_link`。
6. 再引入 `base_footprint` 和动态姿态 TF，解决站立倾斜问题。

## 7. 推荐最终状态

最终建议架构：

```text
systemd
  -> rosbridge
  -> system_manager_node

system_manager_node
  -> start_slam:
       sensors + FastLIO odom + slam_toolbox mapping
  -> start_nav:
       sensors + FastLIO odom + map_server + AMCL + Nav2
  -> stop_all:
       lifecycle shutdown + full process cleanup + zero MotionCmd

TF:
  map -> odom                 AMCL 或 slam_toolbox
  odom -> base_footprint      FastLIO/EKF planar odom
  base_footprint -> base_link stance/IMU dynamic TF
  base_link -> livox_frame    calibrated static TF
  base_link -> camera_link    calibrated static TF

Nav2:
  global_frame = map
  local_frame = odom
  robot_base_frame = base_footprint
  odom_topic = /Odometry 或 /odometry/filtered

Scan:
  pointcloud_to_laserscan target_frame = base_footprint 或经过验证的 base frame
  AMCL scan_topic = /scan
  costmap observation source = /scan，必要时再加深度相机
```

这套方案可以同时满足：

- 建图时保留 FastLIO 的平滑里程计优势。
- 导航时让 AMCL 负责 2D 静态地图全局定位。
- 避免 AMCL 和 FastLIO 同时争夺全局坐标。
- 让双足轮式机器人站立倾斜通过 `base_footprint -> base_link` 表达，而不是破坏 Nav2 的 2D 平面假设。
- 从根源上减少 scan/map 中心对称、前后反、导航启动后地图/TF 残留等问题。
