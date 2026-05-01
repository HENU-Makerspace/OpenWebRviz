#!/usr/bin/env bash
set -euo pipefail

VIDEO_DEVICE="/dev/video0"
VIDEO_PORT="8004"
VIDEO_WIDTH="1280"
VIDEO_HEIGHT="720"
VIDEO_FRAMERATE="30/1"
VIDEO_BITRATE="4000"
VIDEO_FACE_FRAME_RATE="6/1"
VIDEO_ENV_FILE="${HOME}/.config/webbot/video.env"

if [[ -f "${VIDEO_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${VIDEO_ENV_FILE}"
fi

STATE_DIR="${HOME}/.local/state/webbot-media"
FRAME_DIR="${STATE_DIR}/frames"
LOG_FILE="${STATE_DIR}/video.log"

mkdir -p "${STATE_DIR}"
mkdir -p "${FRAME_DIR}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}" >&2
}

cleanup_video_processes() {
  pkill -f -- "gst-launch-1.0 v4l2src device=${VIDEO_DEVICE}" 2>/dev/null || true
  rm -f "${FRAME_DIR}"/frame-*.jpg 2>/dev/null || true
}

wait_for_video_device() {
  local attempt

  for attempt in $(seq 1 20); do
    if [[ -e "${VIDEO_DEVICE}" ]]; then
      return 0
    fi
    sleep 0.5
  done

  return 1
}

if [[ "${1:-}" == "cleanup-only" ]]; then
  cleanup_video_processes
  exit 0
fi

cleanup_video_processes

if ! command -v gst-launch-1.0 >/dev/null 2>&1; then
  log "gst-launch-1.0 is not installed"
  exit 1
fi

if ! wait_for_video_device; then
  log "Video device ${VIDEO_DEVICE} did not appear in time"
  exit 1
fi

: >"${LOG_FILE}"
log "Starting video pipeline on ${VIDEO_DEVICE}"

exec gst-launch-1.0 \
  v4l2src device="${VIDEO_DEVICE}" do-timestamp=true ! \
  image/jpeg,width="${VIDEO_WIDTH}",height="${VIDEO_HEIGHT}",framerate="${VIDEO_FRAMERATE}" ! \
  jpegdec ! \
  nvvideoconvert ! \
  tee name=t \
    t. ! queue ! video/x-raw,format=I420 ! \
      x264enc bitrate="${VIDEO_BITRATE}" tune=zerolatency speed-preset=ultrafast ! \
      rtph264pay config-interval=1 pt=96 ! \
      udpsink host=127.0.0.1 port="${VIDEO_PORT}" \
    t. ! queue ! \
      videorate ! video/x-raw,framerate="${VIDEO_FACE_FRAME_RATE}" ! \
      jpegenc ! multifilesink location="${FRAME_DIR}/frame-%05d.jpg" max-files=4
