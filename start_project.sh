#!/usr/bin/env bash
set -euo pipefail

PROFILE="local"
ROBOT_IP=""
SKIP_INSTALL=0
NO_BROWSER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    --robot-ip|--robot-host)
      ROBOT_IP="${2:-}"
      shift 2
      ;;
    --robot-ip=*|--robot-host=*)
      ROBOT_IP="${1#*=}"
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --no-browser)
      NO_BROWSER=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$PROFILE" != "local" && "$PROFILE" != "cloud" ]]; then
  echo "Invalid profile: $PROFILE. Expected local or cloud." >&2
  exit 2
fi

cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed or not available on PATH." >&2
  exit 1
fi

if [[ "$SKIP_INSTALL" != "1" ]]; then
  echo "[1/3] Installing dependencies..."
  bun install
fi

if [[ -n "$ROBOT_IP" ]]; then
  export ROBOT_HOST="$ROBOT_IP"
  export JETSON_HOST="$ROBOT_IP"
  export FRONTEND_WS_URL="ws://${ROBOT_IP}:9090"
  export VITE_ROSBRIDGE_PROXY_TARGET="ws://${ROBOT_IP}:9090"
  echo "Using robot IP: $ROBOT_IP"
fi

echo "[2/3] Starting project..."
bun run "dev:${PROFILE}" &
PID=$!

TARGET_URL="http://localhost:3000/"

if [[ "$NO_BROWSER" == "1" ]]; then
  echo "[3/3] Browser auto-open is disabled."
  echo "Project started in process ID $PID"
  wait "$PID"
  exit 0
fi

echo "[3/3] Waiting for $TARGET_URL and opening browser..."

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "$TARGET_URL" >/dev/null 2>&1; then
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$TARGET_URL" >/dev/null 2>&1 || true
    fi
    echo "Opened $TARGET_URL"
    wait "$PID"
    exit 0
  fi
  sleep 1
done

echo "Project started in process ID $PID, but $TARGET_URL was not reachable in time."
wait "$PID"
