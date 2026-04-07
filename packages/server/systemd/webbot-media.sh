#!/usr/bin/env bash
set -euo pipefail

JANUS_BINARY="/opt/janus/bin/janus"
JANUS_HTML_DIR="/opt/janus/share/janus/html"
JANUS_DEMO_PORT="8000"

AUDIO_CAPTURE_DEVICE="plughw:CARD=UACDemoV10,DEV=0"
AUDIO_CAPTURE_PORT="5005"

AUDIO_PLAYBACK_DEVICE="plughw:CARD=UACDemoV10,DEV=0"
AUDIO_PLAYBACK_PORT="5006"

VIDEO_DEVICE="/dev/video0"
VIDEO_PORT="8004"
VIDEO_WIDTH="1280"
VIDEO_HEIGHT="720"
VIDEO_FRAMERATE="30/1"
VIDEO_BITRATE="4000"

STATE_DIR="${HOME}/.local/state/webbot-media"
mkdir -p "${STATE_DIR}"

PIDS=()

cleanup_legacy_processes() {
  local patterns=(
    "${JANUS_BINARY}"
    "python3 -m http.server ${JANUS_DEMO_PORT} --directory ${JANUS_HTML_DIR}"
    "gst-launch-1.0 -v alsasrc device=${AUDIO_CAPTURE_DEVICE}"
    "gst-launch-1.0 -v udpsrc port=${AUDIO_PLAYBACK_PORT}"
    "gst-launch-1.0 v4l2src device=${VIDEO_DEVICE}"
  )

  for pattern in "${patterns[@]}"; do
    pkill -f -- "${pattern}" 2>/dev/null || true
  done

  sleep 1
}

cleanup() {
  trap - EXIT INT TERM

  for pid in "${PIDS[@]:-}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
  done

  cleanup_legacy_processes
}

trap cleanup EXIT INT TERM

if [[ "${1:-}" == "cleanup-only" ]]; then
  cleanup_legacy_processes
  exit 0
fi

start_process() {
  local name="$1"
  shift

  "$@" >>"${STATE_DIR}/${name}.log" 2>&1 &
  PIDS+=("$!")
}

wait_for_port() {
  local port="$1"
  local attempt

  for attempt in $(seq 1 20); do
    if ss -ltnup | grep -Eq ":${port}([^0-9]|$)"; then
      return 0
    fi
    sleep 0.5
  done

  return 1
}

cleanup_legacy_processes

start_process janus bash -lc "exec ${JANUS_BINARY}"
wait_for_port "8088"
sleep 1

start_process demo-http python3 -m http.server "${JANUS_DEMO_PORT}" --directory "${JANUS_HTML_DIR}"
start_process audio-capture bash -lc \
  "exec gst-launch-1.0 -v alsasrc device=\"${AUDIO_CAPTURE_DEVICE}\" ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host=127.0.0.1 port=${AUDIO_CAPTURE_PORT}"
start_process audio-playback bash -lc \
  "exec gst-launch-1.0 -v udpsrc port=${AUDIO_PLAYBACK_PORT} caps=\"application/x-rtp, media=(string)audio, clock-rate=(int)48000, encoding-name=(string)OPUS, payload=(int)111\" ! queue ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! alsasink device=\"${AUDIO_PLAYBACK_DEVICE}\""
start_process video-pipeline bash -lc \
  "exec gst-launch-1.0 v4l2src device=${VIDEO_DEVICE} do-timestamp=true ! image/jpeg,width=${VIDEO_WIDTH},height=${VIDEO_HEIGHT},framerate=${VIDEO_FRAMERATE} ! jpegdec ! nvvideoconvert ! 'video/x-raw,format=I420' ! x264enc bitrate=${VIDEO_BITRATE} tune=zerolatency speed-preset=ultrafast ! rtph264pay config-interval=1 pt=96 ! udpsink host=127.0.0.1 port=${VIDEO_PORT}"

wait -n "${PIDS[@]}"
