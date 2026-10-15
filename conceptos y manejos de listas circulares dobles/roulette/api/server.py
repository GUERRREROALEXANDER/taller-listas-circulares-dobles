"""HTTP server: JSON API under ``/api`` plus static serving of ``frontend/``.

Built on :class:`http.server.ThreadingHTTPServer`. A single
:class:`threading.Lock` guards every access to the game, since handler
threads run concurrently. See docs/ARCHITECTURE.md section 5 for the
endpoint contract.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from roulette.api import serializers
from roulette.data_structures.circular_doubly_linked_list import Direction
from roulette.game.roulette_game import RouletteGame
from roulette.models.bet import BetType

#: Static content types required by the contract (plus a few common extras).
CONTENT_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

_DEFAULT_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


class RouletteHTTPServer(ThreadingHTTPServer):
    """Threading server carrying the game, its lock and the static root."""

    daemon_threads = True

    def __init__(self, address: tuple[str, int], game: RouletteGame,
                 static_dir: Path) -> None:
        super().__init__(address, _RouletteRequestHandler)
        self.game = game
        self.lock = threading.Lock()
        self.static_dir = static_dir.resolve()
        self.quiet = False  # set True to suppress per-request logging


class _RouletteRequestHandler(BaseHTTPRequestHandler):
    """Routes requests to the JSON API or to the static file server."""

    server: RouletteHTTPServer  # narrowed type for the attributes above

    # ------------------------------------------------------------------
    # plumbing
    # ------------------------------------------------------------------
    def log_message(self, format: str, *args: Any) -> None:
        if not self.server.quiet:
            super().log_message(format, *args)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def _read_body(self) -> dict[str, Any]:
        """Parse the JSON request body; ``{}`` when empty. 400 on bad JSON."""
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("request body is not valid JSON")
        if not isinstance(data, dict):
            raise ValueError("request body must be a JSON object")
        return data

    def do_OPTIONS(self) -> None:  # noqa: N802 (http.server naming)
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ------------------------------------------------------------------
    # routing
    # ------------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        path = unquote(urlsplit(self.path).path)
        query = parse_qs(urlsplit(self.path).query)
        if path == "/api" or path.startswith("/api/"):
            try:
                with self.server.lock:
                    self._handle_api(method, path, query)
            except ValueError as exc:
                self._send_error(400, str(exc))
            except IndexError as exc:
                self._send_error(400, str(exc))
        elif method == "GET":
            self._serve_static(path)
        else:
            self._send_error(404, f"unknown route: {method} {path}")

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------
    def _handle_api(self, method: str, path: str,
                    query: dict[str, list[str]]) -> None:
        game = self.server.game
        segments = [s for s in path.split("/") if s]  # e.g. ["api", "bets", "3"]

        if method == "GET" and path == "/api/state":
            self._send_json(200, serializers.game_state_json(game))
            return

        if method == "GET" and path == "/api/wheel/order":
            label = query.get("direction", ["forward"])[0]
            if label == "forward":
                direction = Direction.FORWARD
            elif label == "backward":
                direction = Direction.BACKWARD
            else:
                raise ValueError("direction must be 'forward' or 'backward'")
            self._send_json(200, serializers.wheel_order_json(game.wheel,
                                                              direction, label))
            return

        if method == "GET" and len(segments) == 3 and segments[:2] == ["api", "pockets"]:
            try:
                number = int(segments[2])
            except ValueError:
                self._send_error(404, f"unknown pocket: {segments[2]!r}")
                return
            try:
                detail = serializers.pocket_detail_json(game.wheel, number)
            except ValueError as exc:
                self._send_error(404, str(exc))
                return
            self._send_json(200, detail)
            return

        if method == "POST" and path == "/api/players":
            body = self._read_body()
            if "name" not in body or "balance" not in body:
                raise ValueError("body must include 'name' and 'balance'")
            game.add_player(body["name"], body["balance"])
            self._send_json(200, serializers.game_state_json(game))
            return

        if (method == "DELETE" and len(segments) == 3
                and segments[:2] == ["api", "players"]):
            game.remove_player(segments[2])
            self._send_json(200, serializers.game_state_json(game))
            return

        if method == "POST" and path == "/api/bets":
            body = self._read_body()
            missing = {"player", "type", "value", "amount"} - body.keys()
            if missing:
                raise ValueError(f"missing fields: {sorted(missing)}")
            try:
                bet_type = BetType(str(body["type"]))
            except ValueError:
                raise ValueError(f"unknown bet type: {body['type']!r}") from None
            game.place_bet(body["player"], bet_type, body["value"], body["amount"])
            self._send_json(200, serializers.game_state_json(game))
            return

        if (method == "DELETE" and len(segments) == 3
                and segments[:2] == ["api", "bets"]):
            try:
                bet_id = int(segments[2])
            except ValueError:
                raise ValueError(f"bet id must be an int, got {segments[2]!r}")
            game.cancel_bet(bet_id)
            self._send_json(200, serializers.game_state_json(game))
            return

        if method == "POST" and path == "/api/spin":
            body = self._read_body()
            outcome = game.spin(wheel_steps=body.get("wheel_steps"),
                                ball_steps=body.get("ball_steps"))
            self._send_json(200, serializers.spin_outcome_json(outcome, game))
            return

        if method == "POST" and path == "/api/history/cursor":
            body = self._read_body()
            game.move_history_cursor(str(body.get("direction")))
            self._send_json(200, serializers.game_state_json(game))
            return

        if method == "POST" and path == "/api/reset":
            body = self._read_body()
            game.reset()
            if body.get("demo"):
                game.add_player("Ana", 100)
                game.add_player("Luis", 100)
            self._send_json(200, serializers.game_state_json(game))
            return

        self._send_error(404, f"unknown route: {method} {path}")

    # ------------------------------------------------------------------
    # static files
    # ------------------------------------------------------------------
    def _serve_static(self, path: str) -> None:
        root = self.server.static_dir
        relative = "index.html" if path == "/" else path.lstrip("/")
        candidate = (root / relative).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            self._send_error(404, f"not found: {path}")
            return
        body = candidate.read_bytes()
        content_type = CONTENT_TYPES.get(candidate.suffix.lower(),
                                         "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def create_server(host: str, port: int, game: RouletteGame | None = None,
                  static_dir: str | Path | None = None) -> RouletteHTTPServer:
    """Build the server (not yet serving) bound to ``(host, port)``.

    ``game`` defaults to a fresh :class:`RouletteGame`; ``static_dir``
    defaults to the project's ``frontend/`` folder.
    """
    return RouletteHTTPServer(
        (host, port),
        game if game is not None else RouletteGame(),
        Path(static_dir) if static_dir is not None else _DEFAULT_STATIC_DIR,
    )
