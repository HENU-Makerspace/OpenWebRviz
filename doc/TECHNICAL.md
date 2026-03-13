# WebBot-Viz 技术文档

## 项目概述

WebBot-Viz 是一个基于 Web 的 ROS 2 可视化工具，类似轻量级 RViz，通过 rosbridge_websocket 连接 ROS 2 仿真环境并以 2D 方式渲染传感器数据和地图。

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun 1.3.x |
| 后端 | Hono (无数据库) |
| 前端 | React 18 + Vite + TypeScript |
| 样式 | Tailwind CSS |
| ROS 通信 | roslib (npm 包) |
| 渲染 | HTML5 Canvas API |

## 项目结构

```
packages/
├── server/           # Hono 后端
│   ├── src/          # 服务端代码
│   ├── config/       # SLAM 配置文件
│   ├── maps/        # 保存的地图文件
│   └── package.json
└── client/           # React 前端
    ├── src/
    │   ├── components/   # UI 组件
    │   │   ├── ConnectionStatus.tsx   # 连接状态
    │   │   ├── LayerControl.tsx      # 图层控制
    │   │   ├── MapCanvas.tsx         # 地图画布
    │   │   └── ImageOverlay.tsx      # 图像叠加
    │   ├── hooks/          # React Hooks
    │   │   ├── useRosConnection.ts   # ROS 连接管理
    │   │   ├── useRosMap.ts          # 地图订阅
    │   │   ├── useRosTf.ts           # TF 坐标变换
    │   │   ├── useRosPath.ts         # 路径订阅
    │   │   ├── useKeyboardTeleop.ts  # 键盘控制
    │   │   └── useSlamControl.ts     # SLAM 控制
    │   └── App.tsx         # 主应用
    └── package.json
doc/                   # 文档
start_webbot_viz.sh    # 机器人启动脚本
```

## 已实现功能

### 1. 连接管理
- 通过 WebSocket 连接到 rosbridge_websocket (默认 ws://localhost:9090)
- 连接状态管理：disconnected / connecting / connected / error
- 手动重连按钮
- 连接状态显示

### 2. 地图渲染
- 订阅 `/map` 话题 (nav_msgs/msg/OccupancyGrid)
- Canvas 渲染：栅格地图（白色=空闲，灰色=未知，黑色=占用）
- Origin 在左上角
- 交互：鼠标拖拽平移、滚轮缩放

### 3. TF 机器人位置
- 订阅 `/tf` 获取机器人位置
- 支持多种 frame：base_link, base_footprint, robot_base, base
- 绿色圆圈 + 方向箭头显示

### 4. 路径显示
- 全局路径：`/plan` (紫色)
- 局部路径：`/local_plan` (黄色)

### 5. 图层控制
- Map / TF / Global Plan / Local Plan / Image Toggle
- 暂停/恢复功能

### 6. SLAM 控制 (UI)
- 启动/停止 Rosbridge
- 启动/停止 SLAM
- 保存地图
- TMUX 模式运行机器人脚本

### 7. 键盘控制
- W/↑ 前进，S/↓ 后退
- A/← 左转，D/→ 右转
- 发布 TwistStamped 到 `/cmd_vel`

### 8. 导航模式
- 点击地图发布目标点到 `/goal_pose`
- 保存/加载地图

## SLAM 配置

配置文件：`packages/server/config/slam_default.yaml`

关键参数：
- `map_update_interval: 1.0` - 地图更新间隔（秒）
- `publish_period: 1.0` - 地图发布间隔（秒）
- `throttle_scans: 1` - 不跳过扫描
- `minimum_time_interval: 0.5` - 扫描处理间隔

## 测试流程

### 1. 启动后端
```bash
cd packages/server
bun run start
# http://localhost:4001
```

### 2. 启动前端
```bash
cd packages/client
bunx vite preview --port 3000
# http://localhost:3000
```

### 3. 启动 ROS 仿真（TMUX 方式）
在 UI 点击 "Run Robot Script (TMUX)" 按钮，或：
```bash
tmux new -s webbot_viz -d "bash /path/to/start_webbot_viz.sh"
```

### 4. 停止
```bash
# 停止 TMUX
curl -X POST http://localhost:4001/api/slam/stop-tmux
# 或在 UI 点击 "Stop SLAM"
```

### 5. 保存地图
在 Teleop 模式下点击 "Save Map"

## 启动脚本 (start_webbot_viz.sh)

此脚本在机器人端运行，启动：
1. Gazebo 仿真 (TurtleBot3)
2. robot_state_publisher (发布 TF)
3. SLAM Toolbox

脚本位于项目根目录，支持 TMUX 方式运行。

## 运行命令汇总

```bash
# 安装依赖
bun install

# 构建
cd packages/server && bun run build
cd packages/client && bun run build

# 启动后端
cd packages/server && bun run start

# 启动前端
cd packages/client && bunx vite preview --port 3000

# 启动 ROS 仿真（TMUX）
curl -X POST http://localhost:4001/api/slam/start-tmux -H "Content-Type: application/json" -d '{}'

# 停止 ROS 仿真
curl -X POST http://localhost:4001/api/slam/stop-tmux

# 保存地图
curl -X POST http://localhost:4001/api/maps/save -H "Content-Type: application/json" -d '{"name": "my_map"}'

# 查看地图列表
curl http://localhost:4001/api/maps
```

## 已知问题

1. **TF 更新**：确保 robot_state_publisher 运行以发布 TF
2. **地图刷新**：SLAM 配置中 `map_update_interval` 影响更新速度
3. ** TwistStamped**：ros_gz_bridge 期望 TwistStamped 类型

## 更新日志

- 2024-03: 添加 SLAM 控制 UI、地图保存、导航模式、路径显示、键盘控制
