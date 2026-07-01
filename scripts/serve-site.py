#!/usr/bin/env python3
"""Serve the generated library and proxy Microsoft Edge neural TTS."""

from __future__ import annotations

import asyncio
import json
import os
import threading
from collections import OrderedDict
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final
from urllib.parse import parse_qs, urlparse

import edge_tts


ROOT: Final = Path(__file__).resolve().parents[1]
DIST_DIR: Final = ROOT / "dist"
VOICE: Final = "zh-CN-XiaoxiaoNeural"
MAX_TEXT_LENGTH: Final = 1_200
MAX_CACHE_ITEMS: Final = 128

audio_cache: OrderedDict[str, bytes] = OrderedDict()
cache_lock = threading.Lock()


async def synthesize(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, VOICE)
    audio = bytearray()

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])

    if not audio:
        raise RuntimeError("Edge TTS returned no audio")
    return bytes(audio)


def cached_audio(text: str) -> bytes:
    with cache_lock:
        cached = audio_cache.get(text)
        if cached is not None:
            audio_cache.move_to_end(text)
            return cached

    audio = asyncio.run(synthesize(text))

    with cache_lock:
        audio_cache[text] = audio
        audio_cache.move_to_end(text)
        while len(audio_cache) > MAX_CACHE_ITEMS:
            audio_cache.popitem(last=False)
    return audio


class LibraryHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        request = urlparse(self.path)
        if request.path == "/api/tts/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "voice": VOICE})
            return
        if request.path == "/api/tts":
            text = parse_qs(request.query).get("text", [""])[0].strip()
            self.send_tts(text)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/tts":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        if content_length <= 0 or content_length > 32_768:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request size"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
            text = str(payload.get("text", "")).strip()
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return

        self.send_tts(text)

    def send_tts(self, text: str) -> None:
        if not text:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Text is required"})
            return
        if len(text) > MAX_TEXT_LENGTH:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": f"Text must not exceed {MAX_TEXT_LENGTH} characters"},
            )
            return

        try:
            audio = cached_audio(text)
        except Exception as error:  # The upstream service can fail independently.
            self.log_error("TTS synthesis failed: %s", error)
            self.send_json(
                HTTPStatus.BAD_GATEWAY,
                {"error": "Microsoft Edge TTS is temporarily unavailable"},
            )
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("X-TTS-Voice", VOICE)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    if not DIST_DIR.exists():
        raise SystemExit("dist/ does not exist; run `npm run build` first")

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "4173"))
    server = ThreadingHTTPServer((host, port), LibraryHandler)
    print(f"Library: http://{host}:{port}/", flush=True)
    print(f"TTS voice: {VOICE}", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
