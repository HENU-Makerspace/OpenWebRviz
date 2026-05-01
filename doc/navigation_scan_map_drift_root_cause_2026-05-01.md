# 导航模式下 scan 快速偏离 map 的根因分析

时间：2026-05-01  
排查对象：

- 本地仓库：`/home/c6h4o2/dev/web/ROS`
- Jetson：`nvidia@192.168.1.58`
- Jetson ROS 工作区：`/home/nvidia/ros2_ws`

## 1. 结论先说

这次问题的根因不是前端渲染。

当前导航模式里，前端看到的“`scan` 很快偏离 `map`，不再对齐”，本质上是 **导航定位链路本身不稳定**，具体是下面三件事叠在一起：

1. **AMCL 使用的 `/scan` 不是原生 2D 雷达，而是从 FastLIO 的 3D 点云 `/cloud_registered_body` 临时投影出来的。**
2. **这个投影链路依赖 `body -> base_footprint` 的实时 TF，而这条 TF 在运行中存在明确的时间戳不同步和缓存错位。**
3. **`base_footprint_projector.py` 的实现把机身倾斜带来的高度偏移投进了 x/y 平面，会让 `base_footprint` 随机身 pitch/roll 发生额外平移，这对双足轮式机器人尤其不合理。**

所以你在前端看到的现象虽然表现成“scan 对不上 map”，但实际更准确的说法是：

- **AMCL 无法稳定维护 `map -> camera_init`**
- 从而导致在 `map` 固定坐标系下显示出来的 scan 迅速漂移

这不是 Web 端画错了，而是导航定位输入本身就在抖。

## 2. 当前导航真实链路

Jetson 当前导航启动文件：

- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py`

当前链路是：

1. Livox 驱动发布原始雷达和 IMU
2. FastLIO 发布：
   - `/Odometry`
   - TF：`camera_init -> body`
   - 点云：`/cloud_registered_body`
3. `base_footprint_projector` 根据 `/Odometry` 再发布：
   - `camera_init -> base_footprint`
   - `base_footprint -> base_link`
4. `pointcloud_to_laserscan` 把 `/cloud_registered_body` 转成 `/scan`
5. AMCL 用：
   - `odom_frame_id = camera_init`
   - `base_frame_id = base_footprint`
   - `scan_topic = /scan`
6. AMCL 发布：
   - `map -> camera_init`

也就是现在的导航 TF 逻辑实际是：

```text
map -> camera_init -> base_footprint -> base_link -> camera_link
                 └-> body
```

这意味着：

- 导航 odom 并不是标准 `odom`
- `/scan` 也不是独立传感器，而是从 LIO 点云二次生成
- AMCL 和里程计并没有真正解耦

## 3. 直接证据

### 3.1 FastLIO 的输出语义

FastLIO 源码中明确写死了：

- `/cloud_registered_body` 的 frame 是 `body`
- `/Odometry` 的父子 frame 是 `camera_init -> body`

见：

- `/home/nvidia/ros2_ws/src/FAST_LIO/src/laserMapping.cpp`

关键位置：

- `publish_frame_body()` 中：
  - `laserCloudmsg.header.frame_id = "body"`
- `publish_odometry()` 中：
  - `odomAftMapped.header.frame_id = "camera_init"`
  - `odomAftMapped.child_frame_id = "body"`
  - TF 同样发布 `camera_init -> body`

这说明导航里喂给 AMCL 的 `/scan`，并不是某个固定激光器 frame 的直接观测，而是基于 `body` 点云再加工。

### 3.2 `pointcloud_to_laserscan` 已经在 AMCL 之前丢消息

Jetson 上 `webbot-system-manager.service` 日志里有反复出现的明确报错：

```text
pointcloud_to_laserscan: Message Filter dropping message: frame 'body' ...
reason 'discarding message because the queue is full'
```

以及：

```text
pointcloud_to_laserscan: Message Filter dropping message: frame 'body' ...
reason 'the timestamp on the message is earlier than all the data in the transform cache'
```

这两类日志都已经出现了多次，时间上覆盖了多次导航启动，不是偶发单次。

含义很明确：

- `/cloud_registered_body` 到 `/scan` 的转换时，TF 没有及时准备好
- 点云消息先到了，但 `body -> base_footprint` 所需 TF 没及时进缓存
- 消息在滤波队列里等不到匹配 TF，最终被丢弃

也就是说，**AMCL 吃到的 scan 流本身就已经不连续、不稳定**。

### 3.3 AMCL 自己也在报 TF 时间外推错误

同一批日志中，AMCL 多次出现：

```text
Failed to transform initial pose in time
Lookup would require extrapolation into the future
when looking up transform from frame [base_footprint] to frame [camera_init]
```

还出现过 global costmap 等待 `map` 变换时报：

```text
Lookup would require extrapolation into the past
```

这些信息说明：

- `camera_init <-> base_footprint` 这条导航核心 TF 链本身就存在时间对不齐
- 问题不是只有前端显示错，也不是只有 costmap 慢
- AMCL 在做最基础的坐标变换时都已经不稳定

### 3.4 当前配置的时间容差太紧，和实际延迟不匹配

导航 launch 里 `pointcloud_to_laserscan` 当前参数：

- `transform_tolerance = 0.05`
- `scan_time = 0.1`

见：

- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py`

但实际日志里 AMCL 的时间外推常常已经达到约 `0.06s ~ 0.14s` 量级。  
也就是说，即便架构不改，当前容差本身也比真实链路抖动小。

这会直接放大消息过滤失败概率。

## 4. `base_footprint_projector.py` 存在逻辑问题

文件：

- `/home/nvidia/ros2_ws/src/jetson_node_pkg/jetson_node_pkg/base_footprint_projector.py`

当前关键逻辑是：

1. 从 `/Odometry` 取 `camera_init -> body`
2. 用固定四元数 `(0, 0, 1, 0)` 给 `body` 额外乘一个 180 度 yaw
3. 把 `(body_to_base_x, body_to_base_y, base_link_z)` 这个偏移向量用 **完整 3D 姿态 `body_q`** 旋转
4. 旋转后的结果直接加到 x/y 上，作为 `camera_init -> base_footprint` 的平移

这有一个非常关键的问题：

- 机器人如果有 pitch/roll
- 而 `base_link_z` 又不是 0
- 那么这个 z 偏移在经过完整 3D 旋转后，会投影出额外的 x/y 分量

换句话说：

- 机器人身体前倾/后仰时
- `base_footprint` 会因为“高度偏移被旋转进平面”而产生额外平移

对双足轮式机器人，这通常不是我们想要的 2D 导航语义。

正确的 `base_footprint` 应该是“导航平面基准”，它可以跟随 yaw，但 **不应该因为上半身轻微倾斜，就在平面里虚假地前后左右漂**。

这会造成两个后果：

1. AMCL 的 base frame 本身在抖
2. `pointcloud_to_laserscan` 的 target frame 也是这个会抖的 `base_footprint`

这会进一步加剧 scan 对 map 的不稳定对齐。

## 5. 为什么 SLAM 模式看上去更正常，导航模式却更容易漂

SLAM 模式下：

- `slam_toolbox` 用 `/scan` 和 `camera_init` 连续建图
- 地图本身是随着当前观测逐步长出来的

导航模式下：

- AMCL 要把当前 `/scan` 去匹配一张已经冻结的历史地图
- 只要 scan 时序不稳、frame 投影不稳、base frame 语义不稳，误差就会很快体现在 `map -> camera_init` 上

所以：

- **SLAM 模式正常，不代表导航定位链是正确的**
- 这两个模式对输入一致性的要求不一样

导航模式更容易把这些问题放大出来。

## 6. 前方只有一两米、其他方向正常的原因

这个现象大概率也不是前端问题，而是当前“3D 点云切 2D scan”的副作用。

当前 `/scan` 来自：

- `/cloud_registered_body`
- 再经过 `pointcloud_to_laserscan`

同时又受这些因素影响：

1. `min_height / max_height` 高度裁剪
2. 机器人机身 pitch/roll
3. `target_frame = base_footprint`
4. Livox 点云并非传统稳定等角度 2D 激光束

因此前方方向如果正好最容易被高度窗口裁掉，或者最容易被机身姿态影响，就会出现：

- 某些方向量程明显短
- 某些方向又正常

这类问题在原生 2D 激光上少见，但在“3D 点云临时投 2D”里很常见。

## 7. 当前导航实现里，最核心的架构问题

最核心的问题不是某一个参数，而是 **定位输入和里程计来源耦合得太紧**。

当前做法等于：

- FastLIO 既提供 odom
- 又提供生成 `/scan` 所需的点云和 TF
- AMCL 再拿这个派生出来的 `/scan` 去修正 FastLIO 的 odom

这在逻辑上是能跑的，但鲁棒性很差，原因是：

1. scan 不是独立稳定传感器
2. odom 和 scan 共享一条时间敏感链
3. 中间还插了一个自定义 `base_footprint_projector`
4. 机器人本体又不是标准刚体平面底盘

所以它很容易进入这种状态：

- 里程计稍有延迟
- TF 稍有缓存错位
- scan 丢几帧
- AMCL 立刻开始漂

## 8. 我认为的根因排序

按重要性排序如下。

### 根因 1：导航 scan 来源架构本身过于脆弱

AMCL 使用的是从 FastLIO 点云二次生成的 `/scan`，而不是稳定、独立、原生的 2D 激光输入。

这是整个问题的第一根因。

### 根因 2：`body -> base_footprint` 相关 TF 存在明确时间不同步

日志已经实锤：

- `queue is full`
- `timestamp earlier than all data in transform cache`
- `Failed to transform initial pose in time`

这不是“可能”，而是已经发生。

### 根因 3：`base_footprint_projector.py` 的平面投影算法不正确

当前算法会把机身倾斜和 z 偏移耦合进 x/y，导致 `base_footprint` 本身不稳定。

对于双足轮式机器人，这个问题会比普通平面小车更明显。

### 根因 4：系统实时性余量不足，进一步放大问题

日志里还出现过：

- controller loop missed rate
- planner loop missed rate

再结合你之前已经确认过的功耗/负载问题，可以判断：

- 当系统负载一高
- TF、scan、AMCL 的时间对齐会更差

这会放大前面三个问题，但它不是第一根因。

## 9. 正确的导航实现方向

这部分是后续整改方向，不是本次“已完成修复”。

### 9.1 TF 语义要标准化

导航上应该收敛成：

```text
map -> odom -> base_footprint -> base_link -> sensor frames
```

其中：

- FastLIO 负责连续局部里程计：`odom -> base_*`
- AMCL 只负责全局修正：`map -> odom`

不要继续让 `camera_init` 这个 LIO 内部语义名字直接承担导航 odom 角色太久。

### 9.2 `base_footprint` 的生成逻辑必须重写

应改成：

- 平移只保留导航需要的平面分量
- yaw 取朝向
- 不要把 z 偏移经过 roll/pitch 旋转后再注入 x/y

否则机器人一倾斜，导航基准点就在平面里乱飘。

### 9.3 `/scan` 的生成链路要降耦合

如果有条件，最好的方案是：

- AMCL 直接使用独立、稳定的 2D 激光源

如果没有原生 2D 激光，只能继续用 Mid360，那么至少要做到：

1. `/scan` 生成尽量少依赖额外实时 TF
2. 提高 queue / transform tolerance 只是缓解，不是根治
3. 高度裁剪窗口和目标 frame 要重新按传感器安装姿态校准

### 9.4 先解决定位链正确性，再谈 Nav2 参数微调

当前问题不是 DWB、goal tolerance、速度档位这类层面的主问题。

如果底层 scan/TF 已经不稳，继续微调 Nav2 参数只会让问题更难看清。

## 10. 最终判断

本次“scan 在导航模式下快速偏离 map”的根本原因可以明确表述为：

> 当前导航系统把 FastLIO 的点云、里程计和自定义 `base_footprint` 投影链同时作为 AMCL 的输入基础，导致 `/scan` 的生成和 `map -> camera_init` 的定位修正都依赖一条时间敏感且语义不够干净的 TF 链；再叠加 `base_footprint_projector.py` 的平面投影实现不正确，最终使得 scan 在 map 坐标系下很快失配。

因此，接下来正确的修复顺序应该是：

1. 修正 `base_footprint_projector.py` 的平面投影逻辑
2. 稳定 `/cloud_registered_body -> /scan` 的时序链
3. 再决定是否把 `camera_init` 彻底收敛成标准 `odom`
4. 最后才做 AMCL / Nav2 参数层细调

## 11. 本次排查涉及的关键文件

Jetson 端：

- `/home/nvidia/ros2_ws/src/FAST_LIO/src/laserMapping.cpp`
- `/home/nvidia/ros2_ws/src/FAST_LIO/config/mid360.yaml`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/jetson_node_pkg/base_footprint_projector.py`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/nav_all.launch.py`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/stand_nav_launch.py`
- `/home/nvidia/ros2_ws/src/jetson_node_pkg/launch/mapping_all.launch.py`
- `/home/nvidia/ros2_ws/my_nav2_params.yaml`
- `/home/nvidia/ros2_ws/my_slam.yaml`

运行日志来源：

- `journalctl -u webbot-system-manager.service`

