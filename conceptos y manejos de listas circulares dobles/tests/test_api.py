"""End-to-end tests for the JSON API and the static file server.

The server runs in a background thread on an ephemeral port; each test gets
a freshly reset game with the demo players (Ana and Luis, 100 each).
"""

from __future__ import annotations

import http.client
import json
import threading
import unittest
from pathlib import Path
from typing import Any

from roulette.api.server import create_server
from roulette.game.roulette_game import RouletteGame

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
PROJECT_DIR = Path(__file__).resolve().parent.parent


class ApiTestCase(unittest.TestCase):
    """Base class: one shared server, fresh game state per test."""

    server: Any
    thread: threading.Thread
    game: RouletteGame
    port: int

    @classmethod
    def setUpClass(cls) -> None:
        cls.game = RouletteGame()
        cls.server = create_server("127.0.0.1", 0, game=cls.game,
                                   static_dir=FRONTEND_DIR)
        cls.server.quiet = True
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever,
                                      daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self) -> None:
        with self.server.lock:
            self.game.reset()
            self.game.add_player("Ana", 100)
            self.game.add_player("Luis", 100)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def request(self, method: str, path: str,
                body: Any = None) -> tuple[int, dict[str, str], bytes]:
        """Raw request: returns (status, headers, body bytes)."""
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = None if body is None else json.dumps(body)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        data = response.read()
        result = (response.status, dict(response.getheaders()), data)
        conn.close()
        return result

    def request_json(self, method: str, path: str,
                     body: Any = None) -> tuple[int, Any]:
        """Request expecting a JSON body: returns (status, parsed JSON)."""
        status, _, data = self.request(method, path, body)
        return status, json.loads(data.decode("utf-8"))


class TestStateEndpoints(ApiTestCase):
    def test_state_shape(self) -> None:
        status, state = self.request_json("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(state["round"], 0)
        wheel = state["wheel"]
        self.assertEqual(wheel["size"], 37)
        self.assertEqual(wheel["head"], 0)
        self.assertEqual(wheel["tail"], 26)
        self.assertEqual(wheel["marker"], 0)
        self.assertEqual(len(wheel["pockets"]), 37)
        first = wheel["pockets"][0]
        self.assertEqual(first, {"number": 0, "color": "GREEN",
                                 "previous": 26, "next": 32})
        players = {p["name"]: p for p in state["players"]}
        self.assertEqual(players["Ana"],
                         {"name": "Ana", "balance": 100, "committed": 0})
        self.assertEqual(players["Luis"]["balance"], 100)
        self.assertEqual(state["pending_bets"], [])
        history = state["history"]
        self.assertEqual(history["capacity"], 10)
        self.assertEqual(history["size"], 0)
        self.assertEqual(history["results"], [])
        self.assertIsNone(history["cursor"])
        self.assertEqual(history["stats"], {"RED": 0, "BLACK": 0, "GREEN": 0})

    def test_wheel_order_forward_and_backward(self) -> None:
        status, data = self.request_json("GET", "/api/wheel/order")
        self.assertEqual(status, 200)
        self.assertEqual(data["direction"], "forward")
        self.assertEqual(data["start"], 0)
        self.assertEqual(len(data["order"]), 37)
        self.assertEqual([p["number"] for p in data["order"][:3]], [0, 32, 15])

        status, back = self.request_json("GET",
                                         "/api/wheel/order?direction=backward")
        self.assertEqual(status, 200)
        self.assertEqual([p["number"] for p in back["order"][:3]], [0, 26, 3])

    def test_wheel_order_bad_direction(self) -> None:
        status, data = self.request_json("GET",
                                         "/api/wheel/order?direction=sideways")
        self.assertEqual(status, 400)
        self.assertIn("error", data)

    def test_pocket_detail_and_404(self) -> None:
        status, pocket = self.request_json("GET", "/api/pockets/0")
        self.assertEqual(status, 200)
        self.assertEqual(pocket["number"], 0)
        self.assertEqual(pocket["color"], "GREEN")
        self.assertEqual(pocket["previous"], 26)
        self.assertEqual(pocket["next"], 32)
        self.assertEqual(pocket["neighbors"], [3, 26, 0, 32, 15])

        status, err = self.request_json("GET", "/api/pockets/37")
        self.assertEqual(status, 404)
        self.assertIn("error", err)

        status, err = self.request_json("GET", "/api/pockets/abc")
        self.assertEqual(status, 404)
        self.assertIn("error", err)

    def test_unknown_route_404(self) -> None:
        status, err = self.request_json("GET", "/api/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", err)


class TestPlayerAndBetEndpoints(ApiTestCase):
    def test_add_and_remove_player(self) -> None:
        status, state = self.request_json("POST", "/api/players",
                                          {"name": "Mia", "balance": 50})
        self.assertEqual(status, 200)
        names = [p["name"] for p in state["players"]]
        self.assertEqual(names, ["Ana", "Luis", "Mia"])

        status, err = self.request_json("POST", "/api/players",
                                        {"name": "ana", "balance": 10})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

        status, state = self.request_json("DELETE", "/api/players/Mia")
        self.assertEqual(status, 200)
        self.assertEqual([p["name"] for p in state["players"]], ["Ana", "Luis"])

        status, err = self.request_json("DELETE", "/api/players/Nobody")
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_bad_json_body(self) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/api/players", body="{not json",
                     headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        self.assertEqual(response.status, 400)
        self.assertIn("error", data)

    def test_place_and_cancel_bet(self) -> None:
        status, state = self.request_json(
            "POST", "/api/bets",
            {"player": "Ana", "type": "STRAIGHT", "value": 15, "amount": 10})
        self.assertEqual(status, 200)
        self.assertEqual(len(state["pending_bets"]), 1)
        bet = state["pending_bets"][0]
        self.assertEqual(bet["player"], "Ana")
        self.assertEqual(bet["type"], "STRAIGHT")
        self.assertEqual(bet["value"], 15)
        self.assertEqual(bet["amount"], 10)
        self.assertEqual(bet["covered"], [15])
        ana = next(p for p in state["players"] if p["name"] == "Ana")
        self.assertEqual(ana["committed"], 10)

        status, state = self.request_json("DELETE", f"/api/bets/{bet['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(state["pending_bets"], [])

        status, err = self.request_json("DELETE", "/api/bets/999")
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_bet_unknown_player(self) -> None:
        status, err = self.request_json(
            "POST", "/api/bets",
            {"player": "Ghost", "type": "STRAIGHT", "value": 1, "amount": 5})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_bet_insufficient_balance(self) -> None:
        status, err = self.request_json(
            "POST", "/api/bets",
            {"player": "Ana", "type": "COLOR", "value": "RED", "amount": 101})
        self.assertEqual(status, 400)
        self.assertIn("insufficient", err["error"])

    def test_neighbors_bet_covered(self) -> None:
        status, state = self.request_json(
            "POST", "/api/bets",
            {"player": "Luis", "type": "NEIGHBORS", "value": 6, "amount": 10})
        self.assertEqual(status, 200)
        bet = state["pending_bets"][0]
        self.assertEqual(bet["covered"], [17, 34, 6, 27, 13])


class TestSpinEndpoints(ApiTestCase):
    def test_fixed_spin_reference_spin_1(self) -> None:
        """Reference scenario, spin 1: 5 wheel steps, 3 ball steps -> 15."""
        status, outcome = self.request_json(
            "POST", "/api/spin", {"wheel_steps": 5, "ball_steps": 3})
        self.assertEqual(status, 200)
        self.assertEqual(outcome["wheel_steps"], 5)
        self.assertEqual(outcome["ball_steps"], 3)
        self.assertEqual(outcome["effective_wheel_steps"], 5)
        self.assertEqual(outcome["effective_ball_steps"], 3)
        self.assertEqual(outcome["marker_before"], 0)
        self.assertEqual(outcome["marker_after"], 21)
        self.assertEqual(outcome["wheel_path"], [32, 15, 19, 4, 21])
        self.assertEqual(outcome["ball_path"], [4, 19, 15])
        self.assertEqual(outcome["result"], {"number": 15, "color": "BLACK"})
        self.assertEqual(outcome["settlements"], [])
        state = outcome["state"]
        self.assertEqual(state["round"], 1)
        self.assertEqual(state["wheel"]["marker"], 21)
        self.assertEqual(state["history"]["results"],
                         [{"number": 15, "color": "BLACK"}])

    def test_spin_settles_bets(self) -> None:
        self.request_json("POST", "/api/bets",
                          {"player": "Ana", "type": "STRAIGHT",
                           "value": 15, "amount": 10})
        self.request_json("POST", "/api/bets",
                          {"player": "Luis", "type": "COLOR",
                           "value": "RED", "amount": 20})
        status, outcome = self.request_json(
            "POST", "/api/spin", {"wheel_steps": 5, "ball_steps": 3})
        self.assertEqual(status, 200)
        settlements = {s["player"]: s for s in outcome["settlements"]}
        self.assertTrue(settlements["Ana"]["won"])
        self.assertEqual(settlements["Ana"]["delta"], 350)
        self.assertEqual(settlements["Ana"]["balance_after"], 450)
        self.assertFalse(settlements["Luis"]["won"])
        self.assertEqual(settlements["Luis"]["delta"], -20)
        self.assertEqual(settlements["Luis"]["balance_after"], 80)
        players = {p["name"]: p for p in outcome["state"]["players"]}
        self.assertEqual(players["Ana"]["balance"], 450)
        self.assertEqual(players["Luis"]["balance"], 80)

    def test_spin_random_when_steps_omitted(self) -> None:
        status, outcome = self.request_json("POST", "/api/spin", {})
        self.assertEqual(status, 200)
        self.assertGreaterEqual(outcome["wheel_steps"], 37)
        self.assertLessEqual(outcome["wheel_steps"], 185)

    def test_spin_invalid_steps(self) -> None:
        status, err = self.request_json("POST", "/api/spin",
                                        {"wheel_steps": -1})
        self.assertEqual(status, 400)
        self.assertIn("error", err)


class TestHistoryAndReset(ApiTestCase):
    def test_cursor_navigation(self) -> None:
        self.request_json("POST", "/api/spin",
                          {"wheel_steps": 5, "ball_steps": 3})   # 15
        self.request_json("POST", "/api/spin",
                          {"wheel_steps": 10, "ball_steps": 6})  # 34

        status, state = self.request_json("POST", "/api/history/cursor",
                                          {"direction": "older"})
        self.assertEqual(status, 200)
        self.assertEqual(state["history"]["cursor"],
                         {"number": 15, "color": "BLACK"})
        self.assertEqual([r["number"] for r in state["history"]["results"]],
                         [34, 15])

        status, state = self.request_json("POST", "/api/history/cursor",
                                          {"direction": "newer"})
        self.assertEqual(status, 200)
        self.assertEqual(state["history"]["cursor"]["number"], 34)

    def test_cursor_bad_direction(self) -> None:
        self.request_json("POST", "/api/spin",
                          {"wheel_steps": 5, "ball_steps": 3})
        status, err = self.request_json("POST", "/api/history/cursor",
                                        {"direction": "sideways"})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_cursor_empty_history(self) -> None:
        status, err = self.request_json("POST", "/api/history/cursor",
                                        {"direction": "older"})
        self.assertEqual(status, 400)
        self.assertIn("error", err)

    def test_reset_with_demo(self) -> None:
        self.request_json("POST", "/api/players",
                          {"name": "Mia", "balance": 5})
        self.request_json("POST", "/api/spin",
                          {"wheel_steps": 5, "ball_steps": 3})
        status, state = self.request_json("POST", "/api/reset", {"demo": True})
        self.assertEqual(status, 200)
        self.assertEqual(state["round"], 0)
        self.assertEqual(state["wheel"]["marker"], 0)
        players = {p["name"]: p for p in state["players"]}
        self.assertEqual(set(players), {"Ana", "Luis"})
        self.assertEqual(players["Ana"]["balance"], 100)
        self.assertEqual(state["history"]["size"], 0)


class TestStaticAndCors(ApiTestCase):
    def test_index(self) -> None:
        status, headers, data = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertIn(b"<", data)

    def test_css_and_js_content_types(self) -> None:
        status, headers, _ = self.request("GET", "/css/styles.css")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/css; charset=utf-8")

        status, headers, _ = self.request("GET", "/js/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"],
                         "text/javascript; charset=utf-8")

    def test_path_traversal_blocked(self) -> None:
        secret = (PROJECT_DIR / "run.py").read_bytes()
        for path in ("/../run.py", "/%2e%2e/run.py"):
            status, _, data = self.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertNotEqual(data, secret, path)
            self.assertNotIn(b"argparse", data, path)

    def test_options_preflight(self) -> None:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("OPTIONS", "/api/state")
        response = conn.getresponse()
        response.read()
        headers = dict(response.getheaders())
        conn.close()
        self.assertIn(response.status, (200, 204))
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")


if __name__ == "__main__":
    unittest.main()
