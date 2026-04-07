# WebRTC / Janus 移植说明

## 目标

把 Jetson 上已经跑通的 `Janus + GStreamer` demo 接到当前 WebBot-Viz 项目中，同时保持现有职责分层：

- ROS 数据面：继续走 `rosbridge_websocket`
- 机器人流程控制：继续走当前 `server` 的 HTTP API
- 音视频媒体面：浏览器直接走 WebRTC 连 Jetson 上的 Janus

这三条链路不要混在一起。

## 当前项目里的合适接入点

- 前端通过 `/api/config` 获取机器人地址和端口
- 前端直接连接 `ws://<jetson>:9090` 访问 ROS
- 服务端当前负责配置下发、地图管理和建图/导航控制

因此，Janus 最合适的做法不是塞进 rosbridge，也不是把 GStreamer 命令放进 React，而是：

1. Jetson 继续运行 Janus
2. Jetson 继续运行 GStreamer 推流/拉流
3. 当前服务端只下发 Janus 配置
4. 当前前端新增媒体面板或正式 WebRTC 组件

## 推荐架构

### 1. 视频下行

Jetson 摄像头:

`v4l2src -> jpegdec -> nvvideoconvert -> x264enc -> rtph264pay -> udpsink(127.0.0.1:8004)`

Janus Streaming Plugin:

- 从 Jetson 本机 UDP 8004 接收 H264 RTP
- 暴露给浏览器 WebRTC 播放

前端:

- 浏览器打开 Janus streaming 页面，或后续改成你们自己的 Janus 客户端组件

### 2. 音频下行

Jetson 麦克风 / 采集卡:

`alsasrc -> opusenc -> rtpopuspay -> udpsink(127.0.0.1:5005)`

Janus Streaming Plugin:

- 从 Jetson 本机 UDP 5005 接收 OPUS RTP
- 浏览器以 WebRTC 方式接收

### 3. 音频上行

浏览器麦克风:

- 通过 Janus AudioBridge 进入房间

Janus RTP Forward:

- 把房间里的音频 RTP 转发到 `127.0.0.1:5006`

Jetson 播放:

`udpsrc(5006) -> rtpopusdepay -> opusdec -> audioconvert -> alsasink`

## 这个仓库里应该怎么落

### 第一阶段：先接入可用入口

- 在 `packages/server/config/robot_config.yaml` 增加 Janus 配置
- 在 `/api/config` 返回 Janus 地址、demo 地址和媒体页面 URL
- 前端增加 `MediaPanel`，先把 streaming / audiobridge 入口纳入现有 UI

这个阶段的价值是：

- 网络地址不再散落在命令和浏览器书签里
- 前后端和 Jetson 的角色边界明确
- 后续替换成正式页面时不需要推翻现有结构

### 第二阶段：去掉 demo 页面，接成正式前端

这一阶段现在已经落到了当前仓库里：

- 服务端新增了 Jetson 媒体服务控制接口：
  - `/api/media/start`
  - `/api/media/stop`
  - `/api/media/status`
  - `/api/media/talkback/forward/start`
  - `/api/media/talkback/forward/stop`
- 服务端把 Janus HTTP 信令代理到了当前站点：
  - `/api/media/janus`
- 服务端把 Jetson 上的 `janus.js` / `adapter.min.js` 代理到了当前站点：
  - `/api/media/assets/*`
- 前端新增了当前页面内的一键按钮：
  - 启动服务
  - 打开视频
  - 监听机器人声音
  - 开始对讲
  - 全部停止

也就是说，浏览器不再依赖单独打开 `streaming.html` 和 `audiobridge.html`，而是通过 React 组件直接连接 Janus。

React 侧职责现在变成：

- 视频/音频接收：连接 Streaming Plugin
- 音频发送：连接 AudioBridge Plugin

## 当前实现的前提条件

### 1. 当前服务端能免密 SSH 到 Jetson

当前一键化的服务控制是由 `packages/server/src/index.ts` 通过 SSH 远程执行的，因此需要：

- 服务端运行机器可以访问 Jetson
- 已配置好免密 SSH
- `packages/server/config/robot_config.yaml` 里的 `jetson.host` / `jetson.user` 正确

### 2. Jetson 上已有 Janus Streaming / AudioBridge 配置

当前仓库已经把播放器和对讲器接进来了，但 Janus 自身的 mountpoint / room 仍然要在 Jetson 上存在：

- Video streaming mountpoint
- Audio streaming mountpoint
- AudioBridge room

如果你们的 mountpoint ID 固定，可以在 `robot_config.yaml` 里填写：

- `preferred_video_stream_id`
- `preferred_audio_stream_id`

如果不填，前端会自动选择第一个可用的音频或视频流。

## 不建议的做法

- 不建议把音视频继续通过 ROS topic 走 `CompressedImage` 或自定义音频 topic
- 不建议让服务端转发 WebRTC 媒体流
- 不建议把 Janus 命令和 GStreamer 命令直接写死在 React 前端

原因：

- ROS 适合消息和状态，不适合浏览器实时媒体
- 服务端转发媒体会增加延迟和复杂度
- 前端不应该承担 Jetson 侧进程管理

## Jetson 侧建议整理成 systemd

你同事现在是 3 个终端 demo，正式化时建议拆成 systemd 服务：

- `janus.service`
- `janus-video-push.service`
- `janus-audio-capture.service`
- `janus-audio-playback.service`
- 可选：`janus-demo-http.service`

这样前端只关心“能不能连上”，不需要人工开 3 个终端。

## 和当前 ROS 启动链的关系

`packages/server/launch/system_manager.launch.py` 当前负责建图/导航控制，不建议把 Janus 直接塞进这个 launch。

更合适的是：

- ROS launch 继续管理 ROS 节点
- Janus / GStreamer 由 Jetson 系统服务管理
- 当前 Web 服务只读取配置并展示媒体入口

如果后面确实想在 ROS 侧查看媒体状态，可以额外增加一个轻量状态 topic 或 HTTP 健康检查，而不是让 ROS 去托管媒体进程。
