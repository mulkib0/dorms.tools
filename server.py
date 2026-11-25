#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
교무실 전광판 — 함께 쓰는 동기화 서버 (표준 라이브러리만 사용)

  python3 server.py            # http://localhost:8080
  python3 server.py --port 9000
  python3 server.py --no-browser

같은 교내 네트워크에 있는 선생님들은 실행할 때 표시되는
'http://192.168.x.x:8080' 주소로 접속하면 같은 전광판을 함께 봅니다.
"""

import argparse
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "board-data.json"
MAX_BODY = 8 * 1024 * 1024  # 8MB

API_PATH = "/api/state"


# ─────────────────────────── 저장소 ───────────────────────────
class Store:
    """board-data.json 한 개를 리비전과 함께 안전하게 읽고 쓴다."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.revision = 0
        self.state = None
        self.saved_at = None
        self._load()

    def _load(self):
        if not self.path.exists():
            return
        try:
            with self.path.open("r", encoding="utf-8") as fp:
                payload = json.load(fp)
            if isinstance(payload, dict):
                self.revision = int(payload.get("revision") or 0)
                self.state = payload.get("state")
                self.saved_at = payload.get("savedAt")
            else:
                self.state = payload
        except (OSError, ValueError) as err:
            backup = self.path.with_suffix(".broken.json")
            try:
                self.path.replace(backup)
                print(f"⚠  board-data.json 을 읽지 못해 {backup.name} 으로 옮겼습니다: {err}")
            except OSError:
                print(f"⚠  board-data.json 을 읽지 못했습니다: {err}")

    def snapshot(self):
        with self.lock:
            return {
                "revision": self.revision,
                "state": self.state,
                "savedAt": self.saved_at,
            }

    def commit(self, base_revision, new_state):
        """성공하면 (True, 스냅샷), 충돌이면 (False, 현재 스냅샷)."""
        with self.lock:
            if int(base_revision) != self.revision:
                return False, {
                    "revision": self.revision,
                    "state": self.state,
                    "savedAt": self.saved_at,
                }
            self.revision += 1
            self.state = new_state
            self.saved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._write_locked()
            return True, {
                "revision": self.revision,
                "state": self.state,
                "savedAt": self.saved_at,
            }

    def _write_locked(self):
        payload = {
            "revision": self.revision,
            "savedAt": self.saved_at,
            "state": self.state,
        }
        tmp = self.path.with_name(self.path.name + ".tmp")
        with tmp.open("w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp, self.path)  # 원자적 교체 — 전원이 꺼져도 파일이 깨지지 않는다


# ─────────────────────────── 요청 처리 ───────────────────────────
class BoardHandler(BaseHTTPRequestHandler):
    server_version = "GyomushilBoard/1.0"
    protocol_version = "HTTP/1.1"

    @property
    def store(self) -> Store:
        return self.server.store  # type: ignore[attr-defined]

    @property
    def lan_url(self):
        return getattr(self.server, "lan_url", None)  # type: ignore[attr-defined]

    # 로그를 조용하게
    def log_message(self, fmt, *args):
        pass

    def log_error(self, fmt, *args):
        pass

    # ── GET ──
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == API_PATH:
            self._send_json(HTTPStatus.OK, self.store.snapshot())
            return
        if path == "/api/info":
            self._send_json(HTTPStatus.OK, {
                "lanUrl": self.lan_url,
                "port": self.server.server_address[1],  # type: ignore[attr-defined]
                "revision": self.store.revision,
            })
            return
        self._serve_static(path)

    # ── PUT / POST (저장) ──
    def do_PUT(self):
        if urlsplit(self.path).path != API_PATH:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        self._handle_save()

    def do_POST(self):
        self.do_PUT()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path == API_PATH:
            body = json.dumps(self.store.snapshot(), ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ── 구현 ──
    def _handle_save(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "empty body"})
            return
        if length > MAX_BODY:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too large"})
            return

        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as err:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"invalid json: {err}"})
            return

        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "body must be an object"})
            return

        new_state = payload.get("state")
        if not isinstance(new_state, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "state must be an object"})
            return

        try:
            base_revision = int(payload.get("baseRevision") or 0)
        except (TypeError, ValueError):
            base_revision = 0

        ok, snapshot = self.store.commit(base_revision, new_state)
        if not ok:
            self._send_json(HTTPStatus.CONFLICT, snapshot)
            return
        self._send_json(HTTPStatus.OK, {
            "revision": snapshot["revision"],
            "savedAt": snapshot["savedAt"],
        })

    def _serve_static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"

        rel = unquote(path).lstrip("/")
        target = (ROOT / rel).resolve()

        if not self._inside_root(target) or not target.is_file():
            self._send_bytes(HTTPStatus.NOT_FOUND, b"Not found", "text/plain; charset=utf-8")
            return

        ctype, _ = mimetypes.guess_type(target.name)
        if target.suffix == ".json":
            ctype = "application/json; charset=utf-8"
        elif target.suffix in (".html", ".css", ".js"):
            ctype = (ctype or "text/plain") + "; charset=utf-8"

        try:
            body = target.read_bytes()
        except OSError:
            self._send_bytes(HTTPStatus.INTERNAL_SERVER_ERROR, b"Read error", "text/plain")
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def _inside_root(target: Path) -> bool:
        try:
            target.relative_to(ROOT)
            return True
        except ValueError:
            return False

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, body, "application/json; charset=utf-8")

    def _send_bytes(self, status, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


# ─────────────────────────── 실행 ───────────────────────────
def lan_address():
    """교내 다른 기기에서 접속할 주소를 추정한다 (실제로 패킷을 보내지는 않음)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


def make_server(host, port, store, tries=24):
    last_error = None
    for offset in range(tries):
        candidate = port + offset
        try:
            httpd = ThreadingHTTPServer((host, candidate), BoardHandler)
            httpd.daemon_threads = True
            httpd.store = store  # type: ignore[attr-defined]
            ip = lan_address()
            httpd.lan_url = f"http://{ip}:{httpd.server_address[1]}/"  # type: ignore[attr-defined]
            return httpd
        except OSError as err:
            last_error = err
            continue
    raise SystemExit(f"포트 {port}부터 {tries}개를 모두 사용할 수 없습니다: {last_error}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="교무실 전광판 동기화 서버")
    parser.add_argument("--host", default="0.0.0.0", help="기본 0.0.0.0 (같은 네트워크에서 접속 허용)")
    parser.add_argument("--port", type=int, default=8080, help="기본 8080")
    parser.add_argument("--data", default=str(DATA_FILE), help="저장 파일 경로")
    parser.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    args = parser.parse_args(argv)

    store = Store(Path(args.data).resolve())
    httpd = make_server(args.host, args.port, store)
    port = httpd.server_address[1]
    ip = lan_address()

    bar = "─" * 46
    print()
    print(bar)
    print("  교무실 전광판 동기화 서버가 켜졌습니다.")
    print(bar)
    print(f"  이 컴퓨터      http://localhost:{port}")
    print(f"  같은 네트워크  http://{ip}:{port}")
    print()
    print(f"  저장 파일      {store.path}")
    if store.state:
        count = len((store.state or {}).get("notices") or [])
        print(f"  불러온 공지    {count}건 (revision {store.revision})")
    print()
    print("  선생님들께는 위의 '같은 네트워크' 주소를 알려주세요.")
    print("  창을 닫거나 Ctrl+C 를 누르면 서버가 꺼집니다.")
    print(bar)
    print()

    if not args.no_browser:
        def open_later():
            time.sleep(0.8)
            try:
                webbrowser.open(f"http://localhost:{port}")
            except Exception:
                pass
        threading.Thread(target=open_later, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 끕니다. 지금까지의 공지는 그대로 저장되어 있습니다.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    sys.exit(main())
