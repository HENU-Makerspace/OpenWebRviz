#!/usr/bin/env bash
set -euo pipefail

URL="${1:-ws://192.168.1.58:9090}"
DURATION="${2:-10}"

shift $(( $# > 0 ? 1 : 0 )) || true
shift $(( $# > 0 ? 1 : 0 )) || true

if [ "$#" -gt 0 ]; then
  TOPICS=("$@")
else
  TOPICS=("/scan_web" "/tf" "/tf_static" "/map_web" "/plan")
fi

TOPICS_JSON="["
for topic in "${TOPICS[@]}"; do
  case "$topic" in
    /scan|/scan_web|/scan_raw)
      type="sensor_msgs/msg/LaserScan"
      ;;
    /tf|/tf_static)
      type="tf2_msgs/msg/TFMessage"
      ;;
    /map|/map_web)
      type="nav_msgs/msg/OccupancyGrid"
      ;;
    /plan)
      type="nav_msgs/msg/Path"
      ;;
    *)
      echo "Unsupported topic type mapping for: $topic" >&2
      echo "Supported topics: /scan /scan_raw /scan_web /tf /tf_static /map /map_web /plan" >&2
      exit 1
      ;;
  esac

  if [ "$TOPICS_JSON" != "[" ]; then
    TOPICS_JSON+=","
  fi
  TOPICS_JSON+="[\"$topic\",\"$type\"]"
done
TOPICS_JSON+="]"

bun -e '
const [urlArg, durationArg, topicsArg] = process.argv.slice(1);
const url = String(urlArg);
const durationSec = Number(durationArg);
const topics = JSON.parse(topicsArg);
const stats = Object.fromEntries(topics.map(([name]) => [name, { count: 0, bytes: 0 }]));
const ws = new WebSocket(url);
let start = 0;
let done = false;

function finish() {
  if (done) return;
  done = true;
  const dur = Math.max((Date.now() - start) / 1000, 0.001);
  let total = 0;
  console.log(`url=${url} duration=${dur.toFixed(2)}s`);
  for (const [topic, st] of Object.entries(stats)) {
    const hz = st.count / dur;
    const bps = st.bytes / dur;
    total += bps;
    console.log(`${topic}\tcount=${st.count}\thz=${hz.toFixed(2)}\tbytes_per_sec=${bps.toFixed(1)}`);
  }
  console.log(`TOTAL\tbytes_per_sec=${total.toFixed(1)}\tkbps=${(total * 8 / 1000).toFixed(2)}`);
  try { ws.close(); } catch {}
  setTimeout(() => process.exit(0), 50);
}

ws.onopen = () => {
  start = Date.now();
  for (const [topic, type] of topics) {
    ws.send(JSON.stringify({ op: "subscribe", topic, type }));
  }
  setTimeout(finish, durationSec * 1000);
};

ws.onmessage = (ev) => {
  const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
  try {
    const obj = JSON.parse(raw);
    if (obj.topic && stats[obj.topic]) {
      stats[obj.topic].count += 1;
      stats[obj.topic].bytes += Buffer.byteLength(raw, "utf8");
    }
  } catch {}
};

ws.onerror = (err) => {
  console.error("WebSocket error:", err?.message || err);
  process.exit(1);
};

ws.onclose = (event) => {
  if (!done) {
    console.error(`closed code=${event.code} reason=${event.reason || "-"}`);
    process.exit(1);
  }
};
' -- "$URL" "$DURATION" "$TOPICS_JSON"
