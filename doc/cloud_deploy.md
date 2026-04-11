# Cloud Deploy

当前部署目标：

- 云服务器公网 IP：`182.43.86.126`
- 云服务器 Tailscale IP：`100.97.93.120`
- Jetson Tailscale IP：`100.108.168.47`

当前仓库已经按这套链路调整过本地配置：

- 浏览器访问云服务器 `http://182.43.86.126`
- 前端 API 走云服务器 `/api`
- 前端 ROS WebSocket 走云服务器 `ws://182.43.86.126/rosbridge/`
- 云服务器通过 Tailscale 转发到 Jetson `100.108.168.47:9090`
- Janus 仍部署在 Jetson `100.108.168.47`

## 本地已改内容

- [robot_config.yaml](/home/c6h4o2/dev/web/ROS/packages/server/config/robot_config.yaml)
  - `server.host` 改为 `182.43.86.126`
  - `jetson.host` 改为 `100.108.168.47`
  - `frontend.ws_url` 改为 `ws://182.43.86.126/rosbridge/`
  - `media.janus_host` 改为 `100.108.168.47`
- [index.ts](/home/c6h4o2/dev/web/ROS/packages/server/src/index.ts)
  - `/api/config` 会下发 `rosbridgeUrl`
  - Janus API 和 Demo 地址会下发为云服务器代理地址
- [App.tsx](/home/c6h4o2/dev/web/ROS/packages/client/src/App.tsx)
  - 前端改为使用后端下发的 `rosbridgeUrl`
- [vite.config.ts](/home/c6h4o2/dev/web/ROS/packages/client/vite.config.ts)
  - 本地开发增加 `/rosbridge` 代理
- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)
  - 默认上传服务器地址改为 `http://182.43.86.126:4001`
  - Jetson 保存地图后会主动上传到云服务器

## 云服务器需要放置的文件

- Nginx 配置模板：
  - [webbot.conf](/home/c6h4o2/dev/web/ROS/deploy/nginx/webbot.conf)
- 后端 systemd 模板：
  - [webbot-server.service](/home/c6h4o2/dev/web/ROS/deploy/systemd/webbot-server.service)

## Jetson 需要放置的文件

- 媒体启动脚本模板：
  - [webbot-media.sh](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-media.sh)
- 媒体 systemd 模板：
  - [webbot-media.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-media.service)

## 云服务器部署步骤

### 1. 准备目录

建议代码目录：

```bash
/opt/webbot
```

### 2. 构建前后端

在项目根目录执行：

```bash
bun install
bun run build
```

构建后前端静态文件在：

```bash
packages/client/dist
```

建议部署到：

```bash
/usr/share/nginx/html/webbot
```

### 3. 启动后端

后端建议用 systemd：

```bash
sudo cp deploy/systemd/webbot-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webbot-server
sudo systemctl status webbot-server
```

这个服务会从：

```bash
/opt/webbot/packages/server
```

启动 Bun 后端。

### 4. 配置 Nginx

```bash
sudo cp deploy/nginx/webbot.conf /etc/nginx/conf.d/
sudo nginx -t
sudo systemctl reload nginx
```

这份配置会做三件事：

- 直接托管 `/usr/share/nginx/html/webbot` 下的前端静态文件
- 把 `/api/` 转发到本机 `127.0.0.1:4001`
- 把 `/rosbridge/` 转发到 Jetson `100.108.168.47:9090`
- 把 `/janus-demo/` 转发到 Jetson `100.108.168.47:8000`

## Jetson 需要确认的项目

### 1. rosbridge 对 Tailscale 可访问

确保 Jetson 上 `rosbridge_websocket` 监听 `0.0.0.0:9090`。

### 2. Janus 在 Jetson 上运行

可以直接把仓库里的 systemd 模板放到 Jetson：

```bash
install -Dm755 packages/server/systemd/webbot-media.sh ~/bin/webbot-media.sh
install -Dm644 packages/server/systemd/webbot-media.service ~/.config/systemd/user/webbot-media.service
systemctl --user daemon-reload
systemctl --user enable --now webbot-media.service
```

确保 Jetson 上至少有这两个入口：

- `http://100.108.168.47:8088/janus`
- `http://100.108.168.47:8000`

当前脚本行为：

- `Janus` 和 demo HTTP 视为核心进程，任何一个退出都会触发 systemd 重启
- 音频采集、音频回放、视频推流只在设备存在时启动
- 如果采集设备不存在，只会记日志，不会把 Janus 一起拉死

也就是说，如果当前 Jetson 上没有 `UACDemoV10` 或 `/dev/video0`，页面上的 WebRTC 音视频仍然不会正常出流，但至少 Janus API 与 `janus.js` 不会因为采集脚本失败而整体掉线。

要真正出音视频，还是需要把脚本里的设备名改成 Jetson 当前实际存在的设备。

### 3. system_manager_node 使用新地址

重新构建并安装 ROS 包，确保这两个文件的新默认值生效：

- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)

### 4. 不再要求云服务器 SSH 到 Jetson

当前代码已经去掉了服务器侧通过 SSH/SCP 管理 Jetson 的残留逻辑：

- 不再由服务器远程启动 Jetson 采集进程
- 不再由服务器从 Jetson `scp` 地图
- 地图保存后由 Jetson 主动 HTTP 上传到云服务器

也就是说，媒体采集和推流需要在 Jetson 侧自行常驻运行。

## 联调检查顺序

1. 云服务器执行 `curl http://127.0.0.1:4001/api/health`
2. 云服务器执行 `curl http://100.108.168.47:9090`
3. 云服务器执行 `curl http://100.108.168.47:8088/janus`
4. 云服务器执行 `curl http://100.108.168.47:8000`
5. 浏览器打开 `http://182.43.86.126`
6. 浏览器确认 `/api/config` 返回 `rosbridgeUrl` 和 Janus 代理地址
7. 页面确认 ROS 连接成功
8. 再测试地图同步、SLAM、导航和音视频

## 还没做的事

- 还没有配置 HTTPS/WSS
- Janus 媒体面如果要给公网浏览器用，还需要确认 Jetson 的 ICE/TURN 配置

如果下一步要上正式公网，建议继续做：

1. 域名
2. HTTPS
3. `wss://` rosbridge
4. Janus 的 ICE/TURN 配置检查
