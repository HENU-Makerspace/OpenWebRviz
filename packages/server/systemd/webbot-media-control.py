#!/usr/bin/env python3
import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Expose local HTTP controls for the Jetson media services.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=19110)
    parser.add_argument("--video-service", default="webbot-video.service")
    parser.add_argument("--media-service", default="webbot-media.service")
    parser.add_argument("--frame-dir", default=str(Path.home() / ".local" / "state" / "webbot-media" / "frames"))
    parser.add_argument("--video-device", default="/dev/video0")
    parser.add_argument("--start-timeout-ms", type=int, default=12000)
    return parser.parse_args()


def iso_from_timestamp(value: float | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


class MediaControlRuntime:
    def __init__(self, args: argparse.Namespace):
        self.args = args

    def run_systemctl(self, *systemctl_args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["systemctl", "--user", *systemctl_args],
            capture_output=True,
            text=True,
            check=check,
        )

    def read_service_state(self, service_name: str) -> dict[str, str]:
        result = self.run_systemctl(
            "show",
            service_name,
            "--property=ActiveState",
            "--property=SubState",
            "--property=Result",
            check=False,
        )
        state: dict[str, str] = {}
        for line in result.stdout.splitlines():
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            state[key] = value
        return {
            "activeState": state.get("ActiveState", "unknown"),
            "subState": state.get("SubState", "unknown"),
            "result": state.get("Result", "unknown"),
        }

    def latest_frame_info(self) -> tuple[int, str | None]:
        frame_dir = Path(self.args.frame_dir)
        if not frame_dir.exists():
            return 0, None

        frames = sorted(frame_dir.glob("frame-*.jpg"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not frames:
            return 0, None

        return len(frames), iso_from_timestamp(frames[0].stat().st_mtime)

    def video_status(self) -> dict[str, object]:
        state = self.read_service_state(self.args.video_service)
        media_state = self.read_service_state(self.args.media_service)
        frame_count, last_frame_at = self.latest_frame_info()

        return {
            "video": {
                "service": self.args.video_service,
                "active": state["activeState"] == "active",
                "activeState": state["activeState"],
                "subState": state["subState"],
                "result": state["result"],
                "frameCount": frame_count,
                "lastFrameAt": last_frame_at,
                "deviceExists": Path(self.args.video_device).exists(),
            },
            "media": {
                "service": self.args.media_service,
                "active": media_state["activeState"] == "active",
                "activeState": media_state["activeState"],
                "subState": media_state["subState"],
                "result": media_state["result"],
            },
        }

    def start_video(self) -> tuple[dict[str, object], int]:
        self.run_systemctl("reset-failed", self.args.video_service, check=False)
        start_result = self.run_systemctl("start", self.args.video_service, check=False)
        if start_result.returncode != 0:
            return {
                "error": "failed_to_start_video_service",
                "details": (start_result.stderr or start_result.stdout or "").strip(),
                **self.video_status(),
            }, 500

        deadline = time.monotonic() + max(self.args.start_timeout_ms, 1000) / 1000.0
        while time.monotonic() < deadline:
            status = self.video_status()
            video = status["video"]
            if isinstance(video, dict):
                if video.get("active") and int(video.get("frameCount") or 0) > 0:
                    return {
                        "status": "started",
                        **status,
                    }, 200
                if video.get("activeState") == "failed":
                    return {
                        "error": "video_service_failed",
                        **status,
                    }, 500
            time.sleep(0.5)

        return {
            "error": "video_start_timeout",
            **self.video_status(),
        }, 504

    def stop_video(self) -> tuple[dict[str, object], int]:
        stop_result = self.run_systemctl("stop", self.args.video_service, check=False)
        self.run_systemctl("reset-failed", self.args.video_service, check=False)
        status = self.video_status()

        if stop_result.returncode != 0:
            return {
                "error": "failed_to_stop_video_service",
                "details": (stop_result.stderr or stop_result.stdout or "").strip(),
                **status,
            }, 500

        return {
            "status": "stopped",
            **status,
        }, 200


class MediaControlHandler(BaseHTTPRequestHandler):
    runtime: MediaControlRuntime | None = None

    def do_GET(self) -> None:
        if self.runtime is None:
            self.respond_json({"error": "runtime_unavailable"}, 500)
            return

        if self.path == "/status":
            self.respond_json(self.runtime.video_status())
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:
        if self.runtime is None:
            self.respond_json({"error": "runtime_unavailable"}, 500)
            return

        if self.path == "/video/start":
            payload, status = self.runtime.start_video()
            self.respond_json(payload, status)
            return

        if self.path == "/video/stop":
            payload, status = self.runtime.stop_video()
            self.respond_json(payload, status)
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args) -> None:
        return

    def respond_json(self, payload: dict[str, object], status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    args = parse_args()
    runtime = MediaControlRuntime(args)
    MediaControlHandler.runtime = runtime
    server = ThreadingHTTPServer((args.host, args.port), MediaControlHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
