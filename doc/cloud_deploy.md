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
- Janus 仍部署在云服务器 `182.43.86.126`

## 本地已改内容

- [robot_config.yaml](/home/c6h4o2/dev/web/ROS/packages/server/config/robot_config.yaml)
  - `server.host` 改为 `182.43.86.126`
  - `jetson.host` 改为 `100.108.168.47`
  - `frontend.ws_url` 改为 `ws://182.43.86.126/rosbridge/`
  - `media.janus_host` 改为 `182.43.86.126`
- [index.ts](/home/c6h4o2/dev/web/ROS/packages/server/src/index.ts)
  - `/api/config` 会下发 `rosbridgeUrl`
- [App.tsx](/home/c6h4o2/dev/web/ROS/packages/client/src/App.tsx)
  - 前端改为使用后端下发的 `rosbridgeUrl`
- [vite.config.ts](/home/c6h4o2/dev/web/ROS/packages/client/vite.config.ts)
  - 本地开发增加 `/rosbridge` 代理
- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)
  - 默认上传服务器地址改为 `http://182.43.86.126:4001`

## 云服务器需要放置的文件

- Nginx 配置模板：
  - [webbot.conf](/home/c6h4o2/dev/web/ROS/deploy/nginx/webbot.conf)
- 后端 systemd 模板：
  - [webbot-server.service](/home/c6h4o2/dev/web/ROS/deploy/systemd/webbot-server.service)

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

- 直接托管前端静态文件
- 把 `/api/` 转发到本机 `127.0.0.1:4001`
- 把 `/rosbridge/` 转发到 Jetson `100.108.168.47:9090`

## Jetson 需要确认的项目

### 1. rosbridge 对 Tailscale 可访问

确保 Jetson 上 `rosbridge_websocket` 监听 `0.0.0.0:9090`。

### 2. system_manager_node 使用新地址

重新构建并安装 ROS 包，确保这两个文件的新默认值生效：

- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)

### 3. 云服务器能免密 SSH 到 Jetson

当前后端仍会通过 SSH/SCP 访问 Jetson：

- 启停远端进程
- 同步地图文件

所以需要保证云服务器执行下面两条命令都通：

```bash
ssh nvidia@100.108.168.47
scp nvidia@100.108.168.47:/home/nvidia/maps/test.yaml /tmp/
```

## 联调检查顺序

1. 云服务器执行 `curl http://127.0.0.1:4001/api/health`
2. 云服务器执行 `curl http://100.108.168.47:9090`
3. 浏览器打开 `http://182.43.86.126`
4. 浏览器确认 `/api/config` 返回 `rosbridgeUrl`
5. 页面确认 ROS 连接成功
6. 再测试地图同步、SLAM、导航和音视频

## 还没做的事

- 还没有配置 HTTPS/WSS
- 还没有把 Janus 也统一反代到 Nginx
- 目前 Janus 仍按现有端口直接对外提供服务

如果下一步要上正式公网，建议继续做：

1. 域名
2. HTTPS
3. `wss://` rosbridge
4. Janus 的公网端口与 ICE 配置检查
