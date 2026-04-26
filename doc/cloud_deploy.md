# Cloud Deploy

当前部署目标：

- 云服务器公网 IP：`182.43.86.126`
- 云服务器域名：`qiuhua.ying-guang.com`
- Jetson 局域网 IP：`192.168.43.100`

当前仓库已经按这套链路调整过本地配置：

- 浏览器访问云服务器 `https://qiuhua.ying-guang.com`
- 前端 API 走云服务器 `/api`
- 前端 ROS WebSocket 走云服务器 `wss://qiuhua.ying-guang.com/rosbridge/`
- Jetson 主动通过反向 SSH 把 `rosbridge`、`Janus HTTP`、`janus-demo`、`face service` 暴露到云服务器本机回环端口
- Janus 仍部署在 Jetson 本机，不部署在云服务器

## 本地已改内容

- [robot_config.yaml](/home/c6h4o2/dev/web/ROS/packages/server/config/robot_config.yaml)
  - `server.host` 改为 `182.43.86.126`
  - `jetson.host` 改为 `192.168.43.100`
  - `frontend.api_url` 改为 `https://qiuhua.ying-guang.com`
  - `frontend.ws_url` 改为 `wss://qiuhua.ying-guang.com/rosbridge/`
  - `media.janus_host` 改为 `127.0.0.1`
  - 新增 `reverse_tunnel` 配置
  - 新增 `face` 配置
- [index.ts](/home/c6h4o2/dev/web/ROS/packages/server/src/index.ts)
  - `/api/config` 会下发 `rosbridgeUrl`
  - Janus API 和 Demo 地址会下发为云服务器代理地址
  - 新增 `/api/face/health` 与 `/api/face/latest`
- [App.tsx](/home/c6h4o2/dev/web/ROS/packages/client/src/App.tsx)
  - 前端改为使用后端下发的 `rosbridgeUrl`
  - 前端接入人脸识别状态与 overlay
- [vite.config.ts](/home/c6h4o2/dev/web/ROS/packages/client/vite.config.ts)
  - 本地开发增加 `/rosbridge` 代理
- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)
  - 默认上传服务器地址改为 `http://182.43.86.126:4001`
  - Jetson 保存地图后会主动上传到云服务器
- [webbot-reverse-tunnel.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-reverse-tunnel.service)
  - Jetson 主动建立反向 SSH 隧道
- [webbot-face-service.py](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-face-service.py)
- [webbot-face.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-face.service)
  - Jetson 本地提供人脸识别元数据服务

## 云服务器需要放置的文件

- Nginx 配置模板：
  - [webbot.conf](/home/c6h4o2/dev/web/ROS/deploy/nginx/webbot.conf)
- 后端 systemd 模板：
  - [webbot-server.service](/home/c6h4o2/dev/web/ROS/deploy/systemd/webbot-server.service)
- SSH 隧道保活配置模板：
  - [99-webbot-tunnels.conf](/home/c6h4o2/dev/web/ROS/deploy/sshd/99-webbot-tunnels.conf)

## Jetson 需要放置的文件

- 反向隧道 systemd 模板：
  - [webbot-reverse-tunnel.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-reverse-tunnel.service)
- 媒体启动脚本模板：
  - [webbot-media.sh](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-media.sh)
- 媒体 systemd 模板：
  - [webbot-media.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-media.service)
- 人脸识别脚本模板：
  - [webbot-face-service.py](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-face-service.py)
- 人脸识别 systemd 模板：
  - [webbot-face.service](/home/c6h4o2/dev/web/ROS/packages/server/systemd/webbot-face.service)

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

### 4. 配置证书与 Nginx

先准备证书目录：

```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp qiuhua.ying-guang.com_nginx/qiuhua.ying-guang.com_bundle.pem /etc/nginx/ssl/
sudo cp qiuhua.ying-guang.com_nginx/qiuhua.ying-guang.com.key /etc/nginx/ssl/
sudo chmod 600 /etc/nginx/ssl/qiuhua.ying-guang.com.key
```

再安装 Nginx 配置：

```bash
sudo cp deploy/nginx/webbot.conf /etc/nginx/conf.d/
sudo nginx -t
sudo systemctl reload nginx
```

这份配置会做三件事：

- `80` 端口全部跳转到 `https://qiuhua.ying-guang.com`
- `443` 使用域名证书提供 HTTPS / WSS
- 直接托管 `/usr/share/nginx/html/webbot` 下的前端静态文件
- 把 `/api/` 转发到本机 `127.0.0.1:4001`
- 把 `/rosbridge/` 转发到本机 `127.0.0.1:19090`
- 把 `/janus-demo/` 转发到本机 `127.0.0.1:18000`

### 5. 配置云服务器 SSH 反向隧道保活

把仓库里的 `sshd` 配置模板安装到云服务器：

```bash
sudo install -Dm644 deploy/sshd/99-webbot-tunnels.conf /etc/ssh/sshd_config.d/99-webbot-tunnels.conf
sudo /usr/sbin/sshd -t
sudo systemctl reload sshd
```

这一步是为了避免 Jetson 重启、4G 短时掉线或公网 IP 漂移后，云服务器上的旧反向转发会话长期残留，继续占着：

- `127.0.0.1:19090`
- `127.0.0.1:18088`
- `127.0.0.1:18000`
- `127.0.0.1:19100`
- `127.0.0.1:19110`

一旦旧会话还活着，新会话就会在 Jetson 上报：

```text
remote port forwarding failed for listen port 19090
```

然后 `systemd --user` 每秒重试一次，表现出来就是：

- 浏览器 `wss://qiuhua.ying-guang.com/rosbridge/` 偶发连不上
- Jetson 上 `webbot-reverse-tunnel.service` / `webbot-media-tunnel.service` 进入 `auto-restart`
- 云服务器 `sshd` 日志里可能出现 `past MaxStartups`

这份配置的目的：

- `ClientAliveInterval 15` + `ClientAliveCountMax 2`
  - 让云服务器能更快清理已经失联的旧 SSH 隧道
- `MaxStartups 100:30:200`
  - 降低短时重连风暴或公网扫描时误伤 Jetson 重连的概率

## Jetson 需要确认的项目

### 1. rosbridge 在 Jetson 本机可访问

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

### 3. 部署反向 SSH 隧道

Jetson 需要主动连到云服务器，并把本地端口映射到云服务器本机回环：

```bash
install -Dm644 packages/server/systemd/webbot-reverse-tunnel.service ~/.config/systemd/user/webbot-reverse-tunnel.service
install -Dm644 packages/server/systemd/webbot-media-tunnel.service ~/.config/systemd/user/webbot-media-tunnel.service
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now webbot-reverse-tunnel.service
systemctl --user enable --now webbot-media-tunnel.service
systemctl --user status webbot-reverse-tunnel.service
systemctl --user status webbot-media-tunnel.service
```

这里的 `enable-linger` 不是可选项。
如果没有它，Jetson 重启后在第一次有人登录 `nvidia` 之前，`systemd --user` 不会常驻，以上这些 user services 都不会自动启动，表现出来就是：

- 云服务器上 `127.0.0.1:19090` / `18088` / `18000` / `19100` / `19110` 没有监听
- 浏览器 `wss://.../rosbridge/` 连接失败
- 但你一旦 SSH 登录 Jetson，一部分服务又会“突然恢复”

现在拆成两条隧道：

- `webbot-reverse-tunnel.service`
  - 只负责 `9090 -> 19090` 的 `rosbridge`
- `webbot-media-tunnel.service`
  - 负责 Janus / demo / face 相关端口

这样即使媒体链路重连，`rosbridge` 也不会一起抖掉。

如果 Jetson 重启后仍然出现隧道起不来，优先检查两边：

```bash
# Jetson
systemctl --user status webbot-reverse-tunnel.service webbot-media-tunnel.service

# 云服务器
ss -ltnp | egrep ':(19090|18088|18000|19100|19110) '
journalctl -u sshd --since '10 minutes ago' --no-pager | tail -n 200
```

如果 `status` 里出现：

```text
remote port forwarding failed for listen port 19090
```

基本就说明云服务器上的旧 SSH 会话还没有释放对应监听端口，先确认上面第 5 步的 `sshd` 配置是否已经安装生效。

这两条隧道会把下面这些 Jetson 本地服务映射到云服务器 `127.0.0.1`：

- `9090 -> 19090` `rosbridge`
- `8088 -> 18088` `Janus HTTP API`
- `8000 -> 18000` `janus-demo`
- `19100 -> 19100` `face service`

### 4. 部署 Jetson 人脸识别服务

```bash
install -Dm755 packages/server/systemd/webbot-face-service.py ~/bin/webbot-face-service.py
install -Dm644 packages/server/systemd/webbot-face.service ~/.config/systemd/user/webbot-face.service
systemctl --user daemon-reload
systemctl --user enable --now webbot-face.service
systemctl --user status webbot-face.service
```

默认约定 Jetson 上的人脸模型目录是：

```bash
~/face
```

建议单独创建虚拟环境，避免污染 Jetson 现有 ROS/Python 环境：

```bash
python3 -m venv --system-site-packages ~/face/.venv
~/face/.venv/bin/pip install --upgrade pip
~/face/.venv/bin/pip install "numpy<2" "opencv-python-headless<4.10" "matplotlib==3.10.7" insightface==0.7.3
```

其中至少需要：

- `~/face/insightface`
- `~/face/registry.json`
- `~/face/face_db/`

当前实现里，人脸服务不直接读取 `/dev/video0`，而是消费 `webbot-media.service` 在 `~/.local/state/webbot-media/frames/` 下持续刷新的 JPEG 帧。
也就是说，`webbot-media.service` 和 `webbot-face.service` 需要一起运行。

### 5. system_manager_node 使用新地址

重新构建并安装 ROS 包，确保这两个文件的新默认值生效：

- [system_manager_node.py](/home/c6h4o2/dev/web/ROS/packages/server/src/system_manager_node.py)
- [system_manager.launch.py](/home/c6h4o2/dev/web/ROS/packages/server/launch/system_manager.launch.py)

### 6. 不再要求云服务器 SSH 到 Jetson

当前代码已经去掉了服务器侧通过 SSH/SCP 管理 Jetson 的残留逻辑：

- 不再由服务器远程启动 Jetson 采集进程
- 不再由服务器从 Jetson `scp` 地图
- 地图保存后由 Jetson 主动 HTTP 上传到云服务器

也就是说，媒体采集和推流需要在 Jetson 侧自行常驻运行。

## 联调检查顺序

1. 云服务器执行 `curl http://127.0.0.1:4001/api/health`
2. 云服务器执行 `curl http://127.0.0.1:19090`
3. 云服务器执行 `curl http://127.0.0.1:18088/janus`
4. 云服务器执行 `curl http://127.0.0.1:18000`
5. 云服务器执行 `curl http://127.0.0.1:19100/health`
5. 浏览器打开 `https://qiuhua.ying-guang.com`
6. 浏览器确认 `/api/config` 返回 `rosbridgeUrl` 和 Janus 代理地址
7. 页面确认 ROS 连接成功
8. 页面确认视频流和人脸框 overlay 正常
9. 再测试地图同步、SLAM、导航和音视频

## 还没做的事

- Janus 媒体面如果要给公网浏览器用，还需要确认 Jetson 的 ICE/STUN/TURN 配置

如果下一步要上正式公网，建议继续做：

1. Janus 的 ICE/STUN/TURN 配置检查
