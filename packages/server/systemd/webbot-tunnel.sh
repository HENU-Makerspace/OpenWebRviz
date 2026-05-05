#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <ssh-key> <user@host> [ssh options...]" >&2
  exit 2
fi

SSH_KEY="$1"
TARGET="$2"
shift 2

HOST="${TARGET#*@}"
ROUTE_TARGET="${HOST}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

if command -v getent >/dev/null 2>&1; then
  RESOLVED_HOST="$(getent ahostsv4 "${HOST}" 2>/dev/null | awk 'NR==1 {print $1}')"
  if [[ -n "${RESOLVED_HOST:-}" ]]; then
    ROUTE_TARGET="${RESOLVED_HOST}"
  fi
fi

ROUTE_LINE="$(ip route get "${ROUTE_TARGET}" 2>/dev/null | head -n 1 || true)"
BIND_INTERFACE="$(awk '{for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit }}' <<<"${ROUTE_LINE}")"
SOURCE_IP="$(awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' <<<"${ROUTE_LINE}")"

SSH_ARGS=(
  -NT
  -o BatchMode=yes
  -o ExitOnForwardFailure=yes
  -o ConnectTimeout=10
  -o ConnectionAttempts=1
  -o TCPKeepAlive=yes
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=2
  -o IPQoS=throughput
  -o StrictHostKeyChecking=accept-new
  -i "${SSH_KEY}"
)

if [[ -n "${BIND_INTERFACE}" ]]; then
  SSH_ARGS+=(-o "BindInterface=${BIND_INTERFACE}")
fi

log "Starting tunnel to ${TARGET} via ${BIND_INTERFACE:-default-route} src ${SOURCE_IP:-unknown}"
exec /usr/bin/ssh "${SSH_ARGS[@]}" "$@" "${TARGET}"
