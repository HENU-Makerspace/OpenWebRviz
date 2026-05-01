# rosbridge 频繁断连根因排查

排查时间：2026-05-01 00:15-00:25 CST

对象：

- Jetson：`nvidia@192.168.1.58`
- 云服务器：`root@182.43.86.126`
- 前端入口：`wss://qiuhua.ying-guang.com/rosbridge/`

## 结论

云端 `wss://qiuhua.ying-guang.com/rosbridge/` 断连的根因不是 rosbridge 进程崩溃，也不是 nginx 配置错误，而是 Jetson 上作为云端出口的 Quectel EC200A / RNDIS USB 设备反复发生内核级 USB disconnect/re-enumeration。

2026-05-01 12:14 又确认了第二个独立问题：本地模式 `ws://192.168.1.58:9090` 也会断，是因为 Jetson 上 `async_slam_toolbox_node` 曾触发 OOM，systemd 将包含 rosbridge 和 system_manager 的旧 `jetson-ros-startup.service` 整体重启，导致 rosbridge 被牵连重启。

实际链路是：

```text
浏览器
  -> nginx /rosbridge/
  -> 云服务器 127.0.0.1:19090
  -> Jetson 通过 usb0 建立的 SSH reverse tunnel
  -> Jetson 127.0.0.1:9090 rosbridge
```

当 Jetson 的 `usb0` 被 USB 重置时：

1. `usb0` 消失。
2. Jetson 到云服务器的 SSH reverse tunnel 被 reset。
3. 云服务器 `127.0.0.1:19090` 暂时不存在或连接被重置。
4. nginx 对 `/rosbridge/` 返回 `502` 或已升级的 WebSocket 被 upstream reset。
5. 浏览器表现为 rosbridge 断线，几秒到几十秒后重连。

## 关键证据

### 1. Jetson 内核日志显示 USB 物理设备反复断开

`journalctl -k --since "2026-05-01 00:00:00"` 中连续出现：

```text
00:14:52 usb 1-2.1: USB disconnect
00:14:53 usb 1-2.1: new high-speed USB device
00:15:00 usb 1-2.1: USB disconnect
00:15:00 usb 1-2.1: new high-speed USB device
00:16:02 usb 1-2.1: USB disconnect
00:16:02 usb 1-2.1: new high-speed USB device
00:16:06 usb 1-2.1: USB disconnect
00:16:06 usb 1-2.1: new high-speed USB device
```

每次断开时都伴随：

```text
rndis_host ... usb0: unregister 'rndis_host'
option1 ttyUSB0/1/2 disconnected
```

每次重连时都重新注册：

```text
rndis_host ... usb0: register 'rndis_host'
ttyUSB0/1/2 attached
```

### 2. `usb0` 地址递增，与现场观察完全吻合

NetworkManager 日志显示 DHCP 地址连续变化：

```text
00:14:53 usb0 address=192.168.43.101
00:15:00 usb0 address=192.168.43.102
00:16:02 usb0 address=192.168.43.103
00:16:07 usb0 address=192.168.43.104
```

这解释了“每次点击导航后 `ip -br addr` 看到 `192.168.43.x` 加一”的现象：不是 IP 漂移本身导致断线，而是 USB 设备重枚举后 DHCP 重新租约，IP 才递增。

### 3. 云服务器 nginx 明确显示 tunnel upstream 断开

云端 `/var/log/nginx/error.log`：

```text
00:15:35 recv() failed (104: Connection reset by peer) while proxying upgraded connection
00:15:36 connect() failed (111: Connection refused) while connecting to upstream 127.0.0.1:19090
00:16:44 recv() failed (104: Connection reset by peer) while proxying upgraded connection
00:16:45 connect() failed (111: Connection refused) while connecting to upstream 127.0.0.1:19090
```

这说明浏览器断线时，云服务器本地的 `19090` tunnel 端口正在消失或被重置。

### 4. rosbridge 进程本身没有崩溃

Jetson `/home/nvidia/rosbridge.log`：

```text
Rosbridge WebSocket server started on port 9090
Client disconnected. 0 clients total.
Client connected. 1 clients total.
```

没有 rosbridge crash、Python exception 或 systemd restart 证据。它只是看到客户端断开再连上。

### 5. tunnel 确实绑定在 `usb0`

Jetson tunnel 进程：

```text
ssh -NT -o BindInterface=usb0 ... -R 127.0.0.1:19090:127.0.0.1:9090 root@182.43.86.126
```

路由：

```text
182.43.86.126 via 192.168.43.1 dev usb0
```

因此云端 rosbridge 链路完全依赖 `usb0`。`usb0` 一掉，rosbridge 云端入口必断。

### 6. 本地模式断连的独立证据：SLAM OOM 牵连 rosbridge

本地模式下前端默认连接：

```text
ws://192.168.1.58:9090
```

Jetson 当前 `192.168.1.58` 是 `wlP1p1s0` WiFi 地址，不经过云服务器和 `usb0` reverse tunnel。

内核日志：

```text
01:03:28 base_footprint_ invoked oom-killer
01:03:28 Out of memory: Killed process 3605 (async_slam_tool) anon-rss:5837368kB
```

systemd 日志：

```text
01:03:28 jetson-ros-startup.service: A process of this unit has been killed by the OOM killer.
01:04:40 jetson-ros-startup.service: Failed with result 'oom-kill'.
01:04:46 jetson-ros-startup.service: Started Start ROS bridge and MQTT client on boot.
```

旧服务同时启动：

```text
rosbridge_server rosbridge_websocket_launch.xml
jetson_node_pkg system_manager.launch.py
```

因此 SLAM OOM 后整个 unit 被重启，rosbridge PID 改变，本地 WebSocket 必然断开。

## 设备与拓扑

当前 USB 设备：

```text
Bus 001 Device 009: ID 2c7c:6005 Quectel Wireless Solutions Co., Ltd. Android
```

USB 树中它挂在：

```text
Bus 01.Port 2 -> USB 2.0 Hub -> Port 1 -> Quectel EC200A / RNDIS
```

同一个 USB 2.0 Hub 上还有一颗 USB 摄像头：

```text
Port 4 -> LRCP imx334 camera
```

这非常可疑：蜂窝模块、USB 摄像头和 Jetson USB 2.0 Hub 在负载变化时可能出现供电/电流尖峰/线缆压降，导致流量卡 USB 侧掉线。

## 次要风险

### ModemManager 也在反复探测该设备

`ModemManager` 把同一个 Quectel 设备识别为 modem，并反复创建 modem：

```text
creating modem with plugin 'quectel'
could not grab port ttyUSB0
state changed disabled -> enabling -> enabled -> registered
```

这不是本次断线的第一证据，因为内核里是先出现 USB disconnect，再出现 ModemManager 释放端口。但 ModemManager 的 AT 探测可能增加设备不稳定性。既然当前实际联网使用的是 RNDIS `usb0`，不是 ModemManager 拨号，建议后续让 ModemManager 忽略 `2c7c:6005`，减少干扰。

### rosbridge 参数仍有阻塞风险

rosbridge 当前日志提示：

```text
default_call_service_timeout = 0.0
call_services_in_new_thread = False
send_action_goals_in_new_thread = False
```

这可能导致服务调用卡住 rosbridge 主线程，但它不能解释云端 `19090 connection refused` 和 Jetson `usb0 USB disconnect`。它是独立稳定性问题。

2026-05-01 12:14 已修复：

```text
call_services_in_new_thread = True
send_action_goals_in_new_thread = True
default_call_service_timeout = 5.0
```

## 修复优先级

### P0：硬件供电/USB 物理稳定性

必须优先处理：

- 给 Quectel EC200A/流量卡单独供电，或换带外部供电的 USB Hub。
- 不要让流量卡和 USB 摄像头挂在同一个弱供电 USB 2.0 Hub 上。
- 换短线、粗线、质量好的 USB 线。
- 如果可能，把蜂窝模块放到独立 USB 口，摄像头放另一条总线。
- 在导航、相机、雷达同时工作时观察 `journalctl -k -f`，只要再出现 `usb 1-2.1: USB disconnect`，网络必然还会断。

### P1：软件缓解

这些不能解决物理掉电，但能减少抖动和恢复时间：

- 给 `usb0` 建固定 NetworkManager 连接，使用稳定 cloned MAC，避免每次重枚举都创建新的 `Wired connection 1` 和递增 IP。
- 让 ModemManager 忽略 `2c7c:6005`，只用 RNDIS/DHCP，不让它探测 `ttyUSB*`。
- tunnel service 的重连间隔可以从 3 秒降到 1 秒，缩短云端恢复时间。

### P2：rosbridge 自身健壮性

已完成：

- 拆分旧 `jetson-ros-startup.service`。
- 新增 `webbot-rosbridge.service`，只负责 rosbridge/rosapi。
- 新增 `webbot-system-manager.service`，只负责 `/system/*` 管理入口。
- rosbridge 启动参数改为非阻塞 service/action，并给 service call 设置 5 秒默认超时。
- `webbot-rosbridge.service` 设置 `OOMScoreAdjust=-900`，降低被 OOM killer 选中的概率。
- `webbot-system-manager.service` 设置 `OOMPolicy=continue`，避免子进程 OOM 直接把 system_manager unit 作为失败策略扩散。

这能改善 UI 卡顿和 service/action 调用导致的假死，也避免 SLAM OOM 牵连 rosbridge。

验证：

```text
jetson-ros-startup.service: disabled / inactive
webbot-rosbridge.service: enabled / active
webbot-system-manager.service: enabled / active
/rosbridge_websocket call_services_in_new_thread: True
/rosbridge_websocket send_action_goals_in_new_thread: True
/rosbridge_websocket default_call_service_timeout: 5.0
```

重启 `webbot-system-manager.service` 后，rosbridge 进程 PID 保持不变，说明隔离生效。

## 一句话定位

云端 rosbridge “频繁断”的直接根因是 Jetson 的 `usb0` 蜂窝/RNDIS 设备被内核反复当作 USB 拔插，造成 SSH 反向隧道 `19090` 消失；本地 rosbridge 断连的直接根因之一是旧 systemd unit 中 SLAM OOM 牵连 rosbridge 重启。两者都会表现为前端 WebSocket 断线，但故障链不同。
