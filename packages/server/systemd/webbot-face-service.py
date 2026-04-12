#!/usr/bin/env python3
import argparse
import json
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from insightface.app import FaceAnalysis


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve live face-recognition metadata for the WebBot camera.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=19100)
    parser.add_argument("--device", default="/dev/video0")
    parser.add_argument("--frame-dir", default=str(Path.home() / ".local" / "state" / "webbot-media" / "frames"))
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--interval-ms", type=int, default=150)
    parser.add_argument("--frame-stale-ms", type=int, default=1500)
    parser.add_argument("--similarity-threshold", type=float, default=0.35)
    parser.add_argument("--registry-path", default=str(Path.home() / "face" / "registry.json"))
    parser.add_argument("--face-db-dir", default=str(Path.home() / "face" / "face_db"))
    parser.add_argument("--model-root", default=str(Path.home() / "face" / "insightface"))
    return parser.parse_args()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FaceRuntime:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.lock = threading.Lock()
        self.running = True
        self.last_error: str | None = None
        self.last_frame_at: str | None = None
        self.face_features: dict[str, np.ndarray] = {}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.snapshot: dict[str, Any] = {
          "online": False,
          "updatedAt": None,
          "frameWidth": args.width,
          "frameHeight": args.height,
          "faces": [],
        }

        providers = self.resolve_providers([
            "CUDAExecutionProvider",
            "CPUExecutionProvider",
        ])
        self.app = FaceAnalysis(root=args.model_root, providers=providers)
        self.app.prepare(ctx_id=0, det_size=(min(args.width, 640), min(args.height, 640)), det_thresh=0.35)
        self.load_face_db()

    @staticmethod
    def resolve_providers(preferred: list[str]) -> list[str]:
        available = ort.get_available_providers()
        selected = [provider for provider in preferred if provider in available]
        return selected or ["CPUExecutionProvider"]

    def load_face_db(self) -> None:
        registry_path = Path(self.args.registry_path)
        face_db_dir = Path(self.args.face_db_dir)

        if not registry_path.exists():
            self.last_error = f"Registry file not found: {registry_path}"
            return

        with registry_path.open("r", encoding="utf-8") as handle:
            registry = json.load(handle)

        if not face_db_dir.exists():
            self.last_error = f"Face DB directory not found: {face_db_dir}"
            return

        for filename, info in registry.items():
            image_path = face_db_dir / filename
            if not image_path.exists():
                continue

            image = cv2.imread(str(image_path))
            if image is None:
                continue

            faces = self.app.get(image)
            if not faces:
                continue

            face = max(
                faces,
                key=lambda item: (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1]),
            )
            sid = info["sid"]
            self.face_features[sid] = face.normed_embedding
            self.metadata[sid] = info

    def identify(self, embedding: np.ndarray) -> tuple[str | None, float]:
        best_sid = None
        best_score = 0.0

        for sid, known_embedding in self.face_features.items():
            score = float(np.dot(embedding, known_embedding))
            if score > best_score:
                best_score = score
                best_sid = sid

        if best_sid is None or best_score < self.args.similarity_threshold:
            return None, best_score
        return best_sid, best_score

    def update_snapshot(self, frame: np.ndarray, faces: list[Any]) -> None:
        payload = []
        for index, face in enumerate(faces, start=1):
            sid, score = self.identify(face.normed_embedding)
            info = self.metadata.get(sid, {}) if sid else {}
            x1, y1, x2, y2 = [int(round(value)) for value in face.bbox.tolist()]
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(frame.shape[1], x2)
            y2 = min(frame.shape[0], y2)

            label = info.get("name") or f"Unknown_{index}"
            payload.append({
                "id": f"face-{index}",
                "label": label,
                "name": info.get("name"),
                "sid": info.get("sid"),
                "score": round(score, 4),
                "bbox": {
                    "x": x1,
                    "y": y1,
                    "w": max(0, x2 - x1),
                    "h": max(0, y2 - y1),
                },
            })

        with self.lock:
            self.last_frame_at = iso_now()
            self.snapshot = {
                "online": True,
                "updatedAt": self.last_frame_at,
                "frameWidth": int(frame.shape[1]),
                "frameHeight": int(frame.shape[0]),
                "faces": payload,
            }
            self.last_error = None

    def get_snapshot(self) -> dict[str, Any]:
        with self.lock:
            return dict(self.snapshot)

    def get_health(self) -> dict[str, Any]:
        with self.lock:
            return {
                "online": bool(self.snapshot.get("online")),
                "updatedAt": self.snapshot.get("updatedAt"),
                "identitiesLoaded": len(self.face_features),
                "lastError": self.last_error,
                "device": self.args.device,
            }

    def mark_error(self, message: str) -> None:
        with self.lock:
            self.snapshot["online"] = False
            self.last_error = message

    def load_frame_from_dir(self) -> np.ndarray | None:
        frame_dir = Path(self.args.frame_dir)
        if not frame_dir.exists():
            self.mark_error(f"Frame directory not found: {frame_dir}")
            return None

        candidates = sorted(frame_dir.glob("frame-*.jpg"), key=lambda path: path.stat().st_mtime, reverse=True)
        for candidate in candidates[:3]:
            age_ms = (time.time() - candidate.stat().st_mtime) * 1000.0
            if age_ms > max(self.args.frame_stale_ms, 500):
                self.mark_error(f"Latest frame is stale: {int(age_ms)}ms old")
                return None

            try:
                data = candidate.read_bytes()
            except OSError:
                continue

            if not data:
                continue

            buffer = np.frombuffer(data, dtype=np.uint8)
            frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
            if frame is not None:
                return frame

        self.mark_error(f"No readable frames found in {frame_dir}")
        return None

    def capture_from_frame_dir(self) -> None:
        while self.running:
            frame = self.load_frame_from_dir()
            if frame is None:
                time.sleep(1)
                continue

            faces = self.app.get(frame)
            self.update_snapshot(frame, faces)
            time.sleep(max(self.args.interval_ms, 100) / 1000.0)

    def capture_loop(self) -> None:
        if self.args.frame_dir:
            self.capture_from_frame_dir()
            return

        while self.running:
            cap = cv2.VideoCapture(self.args.device, cv2.CAP_V4L2)
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.args.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.args.height)

            if not cap.isOpened():
                self.mark_error(f"Failed to open camera device {self.args.device}")
                time.sleep(2)
                continue

            try:
                while self.running:
                    ok, frame = cap.read()
                    if not ok or frame is None:
                        self.mark_error("Failed to read frame from camera")
                        break

                    faces = self.app.get(frame)
                    self.update_snapshot(frame, faces)
                    time.sleep(max(self.args.interval_ms, 100) / 1000.0)
            finally:
                cap.release()
                time.sleep(1)


class FaceRequestHandler(BaseHTTPRequestHandler):
    runtime: FaceRuntime | None = None

    def do_GET(self) -> None:
        if self.path == "/health":
            self.respond_json(self.runtime.get_health())
            return

        if self.path == "/faces/latest":
            self.respond_json(self.runtime.get_snapshot())
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return

    def respond_json(self, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    args = parse_args()
    runtime = FaceRuntime(args)
    FaceRequestHandler.runtime = runtime

    worker = threading.Thread(target=runtime.capture_loop, daemon=True)
    worker.start()

    server = ThreadingHTTPServer((args.host, args.port), FaceRequestHandler)
    print(f"Face service listening on http://{args.host}:{args.port}")
    try:
      server.serve_forever()
    except KeyboardInterrupt:
      pass
    finally:
      runtime.running = False
      server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
