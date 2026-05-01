# async_slam_toolbox_node OOM 根因

结论：`async_slam_toolbox_node` 吃到 5.8GB 不是单一参数失控，而是上游输入链不稳定后，`slam_toolbox` 在反复初始化、重建图结构、等待 TF、处理异常 scan 的组合效应下把内存推高，最终触发 OOM。

## 直接证据

1. `slam_toolbox` 启动时只打印了正常初始化信息：

```text
Node using stack size 40000000
Using solver plugin solver_plugins::CeresSolver
```

2. 同一批日志里出现：

```text
minimum laser range setting (0.0 m) exceeds the capabilities of the used Lidar (0.3 m)
```

这说明实际跑起来的参数和仓库里的 `my_slam.yaml` 不完全一致，启动链里可能存在旧参数覆盖或 launch 传参漂移。

3. 上游点云转激光链路曾经报过：

```text
Message Filter dropping message: frame 'body' ... discarding message because the queue is full
```

4. 同期 TF 日志里有大量：

```text
Invalid frame ID "map"
Lookup would require extrapolation into the past
Lookup would require extrapolation into the future
```

5. 内核 OOM 发生时，真正被杀的是：

```text
async_slam_tool
```

而不是 rosbridge。

## 根因链

```text
TF / scan / launch 输入不稳定
  -> pointcloud_to_laserscan 队列堆积或丢帧
  -> slam_toolbox 反复等待 TF、重算匹配、初始化地图结构
  -> 轨迹/地图图结构在异常状态下继续增长
  -> async_slam_toolbox_node RSS 漂到 5.8GB
  -> OOM killer 介入
```

## 最可疑的具体点

- `pointcloud_to_laserscan` 的输入链曾报队列满。
- `base_link` / `camera_init` / `body` / `base_footprint` 之间的历史 TF 抖动很重。
- `slam_toolbox` 读取到的最低激光参数与配置文件不一致，说明启动参数可能被覆盖。
- `async_slam_toolbox_node` 和整个 ROS 常驻 unit 曾绑定在一起，所以它一死就把 rosbridge 一起拖重启。

## 现在应当怎么修

- 先把 `slam_toolbox` 的实际启动参数打印出来，确认到底是谁覆盖了 `my_slam.yaml`。
- 确保 `pointcloud_to_laserscan` 的输入稳定，避免 queue full。
- 把所有 SLAM / Nav2 的 frame 关系统一到 `base_footprint`，不要再让 `camera_init`、`body`、`base_link` 混着参与 2D 导航。
- 如果还要继续用 `slam_toolbox`，先把输入链稳定，再看是否还会膨胀。
