# rosbridge 两种连接模式

目标：本地和云服务器同时兼容，前后端代码保持同一套，只通过启动命令/profile 切换。运行时只使用一种入口，不同时连本地和云端。

## 1. 本地模式 `local`

启动：

```bash
bun dev
# 等价于
bun run dev:local
```

默认 rosbridge：

```text
ws://192.168.1.58:9090
```

用途：

- 开发机和 Jetson 在同一局域网。
- 不走云服务器。
- 不依赖 Jetson 的 `usb0` 流量卡隧道。

配置文件：

```text
packages/server/config/robot_config.local.yaml
```

如果你想让浏览器连 `localhost`，仍然属于本地模式，不新增第三种 profile。先开本机端口转发：

```bash
ssh -N -L 9090:127.0.0.1:9090 nvidia@192.168.1.58
```

再用同一个 local profile 覆盖前端 ws 地址：

```bash
FRONTEND_WS_URL=ws://localhost:9090 bun run dev:local
```

## 2. 云端模式 `cloud`

启动：

```bash
bun run dev:cloud
```

云服务器 systemd 也使用 cloud profile。

默认 rosbridge：

```text
wss://qiuhua.ying-guang.com/rosbridge/
```

用途：

- 浏览器访问云服务器。
- Jetson 通过 `usb0` 主动建立 SSH reverse tunnel。
- 云服务器本机 `127.0.0.1:19090` 转到 Jetson `127.0.0.1:9090`。

配置文件：

```text
packages/server/config/robot_config.cloud.yaml
packages/server/config/robot_config.yaml
```

## 前端显示

Rosbridge 面板会显示：

- 当前 profile：`local` 或 `cloud`。
- 实际下发的 WebSocket URL。

如果显示 `cloud`，断连仍会受 Jetson `usb0` 流量卡稳定性影响。
如果显示 `local`，控制链路不走云服务器。
