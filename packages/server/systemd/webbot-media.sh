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
declare -A PID_NAMES=()
declare -A PID_REQUIRED=()

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${STATE_DIR}/service.log" >&2
}

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
  local required="$2"
  shift
  shift

  : >"${STATE_DIR}/${name}.log"
  log "Starting ${name}"
  "$@" >>"${STATE_DIR}/${name}.log" 2>&1 &
  local pid="$!"
  PIDS+=("${pid}")
  PID_NAMES["${pid}"]="${name}"
  PID_REQUIRED["${pid}"]="${required}"
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

remove_pid() {
  local target="$1"
  local remaining=()
  local pid

  for pid in "${PIDS[@]:-}"; do
    if [[ "${pid}" != "${target}" ]]; then
      remaining+=("${pid}")
    fi
  done

  PIDS=("${remaining[@]}")
  unset 'PID_NAMES[$target]'
  unset 'PID_REQUIRED[$target]'
}

extract_alsa_card_name() {
  local device="$1"

  if [[ "${device}" =~ CARD=([^,]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

alsa_device_available() {
  local mode="$1"
  local device="$2"
  local card_name=""

  if ! card_name="$(extract_alsa_card_name "${device}")"; then
    return 0
  fi

  if [[ "${mode}" == "capture" ]]; then
    arecord -l 2>/dev/null | grep -Fq "${card_name}"
    return $?
  fi

  aplay -l 2>/dev/null | grep -Fq "${card_name}"
}

cleanup_legacy_processes

start_process janus required bash -lc "exec ${JANUS_BINARY}"
if ! wait_for_port "8088"; then
  log "Janus did not open port 8088 in time"
  exit 1
fi
sleep 1

start_process demo-http required python3 -m http.server "${JANUS_DEMO_PORT}" --directory "${JANUS_HTML_DIR}"
if ! wait_for_port "${JANUS_DEMO_PORT}"; then
  log "Janus demo HTTP server did not open port ${JANUS_DEMO_PORT} in time"
  exit 1
fi

if command -v gst-launch-1.0 >/dev/null 2>&1; then
  if alsa_device_available capture "${AUDIO_CAPTURE_DEVICE}"; then
    start_process audio-capture optional bash -lc \
      "exec gst-launch-1.0 -v alsasrc device=\"${AUDIO_CAPTURE_DEVICE}\" ! audioconvert ! audioresample ! opusenc ! rtpopuspay ! udpsink host=127.0.0.1 port=${AUDIO_CAPTURE_PORT}"
  else
    log "Skipping audio-capture: ALSA capture device ${AUDIO_CAPTURE_DEVICE} is unavailable"
  fi

  if alsa_device_available playback "${AUDIO_PLAYBACK_DEVICE}"; then
    start_process audio-playback optional bash -lc \
      "exec gst-launch-1.0 -v udpsrc port=${AUDIO_PLAYBACK_PORT} caps=\"application/x-rtp, media=(string)audio, clock-rate=(int)48000, encoding-name=(string)OPUS, payload=(int)111\" ! queue ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! alsasink device=\"${AUDIO_PLAYBACK_DEVICE}\""
  else
    log "Skipping audio-playback: ALSA playback device ${AUDIO_PLAYBACK_DEVICE} is unavailable"
  fi

  if [[ -e "${VIDEO_DEVICE}" ]]; then
    start_process video-pipeline optional bash -lc \
      "exec gst-launch-1.0 v4l2src device=${VIDEO_DEVICE} do-timestamp=true ! image/jpeg,width=${VIDEO_WIDTH},height=${VIDEO_HEIGHT},framerate=${VIDEO_FRAMERATE} ! jpegdec ! nvvideoconvert ! 'video/x-raw,format=I420' ! x264enc bitrate=${VIDEO_BITRATE} tune=zerolatency speed-preset=ultrafast ! rtph264pay config-interval=1 pt=96 ! udpsink host=127.0.0.1 port=${VIDEO_PORT}"
  else
    log "Skipping video-pipeline: video device ${VIDEO_DEVICE} does not exist"
  fi
else
  log "Skipping optional media pipelines: gst-launch-1.0 is not installed"
fi

while ((${#PIDS[@]} > 0)); do
  if wait -n "${PIDS[@]}"; then
    exit_code=0
  else
    exit_code=$?
  fi

  exited_pids=()
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      exited_pids+=("${pid}")
    fi
  done

  for exited_pid in "${exited_pids[@]:-}"; do
    process_name="${PID_NAMES[${exited_pid}]:-unknown}"
    required="${PID_REQUIRED[${exited_pid}]:-optional}"
    remove_pid "${exited_pid}"

    if [[ "${required}" == "required" ]]; then
      log "Required process ${process_name} exited with status ${exit_code}"
      if [[ "${exit_code}" -eq 0 ]]; then
        exit 1
      fi
      exit "${exit_code}"
    fi

    log "Optional process ${process_name} exited with status ${exit_code}; keeping Janus running"
  done
done
