"""Unit tests for the RouletteGame facade, including the section 7 scenario."""

from __future__ import annotations

import random
import unittest

from roulette.game.roulette_game import RouletteGame, Settlement, SpinOutcome
from roulette.models.bet import BetType
from roulette.models.color import Color


class TestPlayersAndBets(unittest.TestCase):
    def setUp(self) -> None:
        self.game = RouletteGame()

    def test_add_player_and_duplicate_names(self) -> None:
        self.game.add_player("Ana", 100)
        with self.assertRaises(ValueError):
            self.game.add_player("ana", 50)  # case-insensitive duplicate
        with self.assertRaises(ValueError):
            self.game.add_player("", 50)
        with self.assertRaises(ValueError):
            self.game.add_player("Luis", -1)

    def test_remove_player_drops_pending_bets(self) -> None:
        self.game.add_player("Ana", 100)
        self.game.place_bet("Ana", BetType.STRAIGHT, 15, 10)
        self.game.remove_player("Ana")
        self.assertEqual(self.game.players, {})
        self.assertEqual(self.game.pending_bets, [])
        with self.assertRaises(ValueError):
            self.game.remove_player("Ana")

    def test_place_bet_checks_balance_plus_committed(self) -> None:
        self.game.add_player("Ana", 100)
        self.game.place_bet("Ana", BetType.STRAIGHT, 15, 60)
        # Only 40 remain available after the committed 60.
        with self.assertRaises(ValueError):
            self.game.place_bet("Ana", BetType.COLOR, "RED", 41)
        self.game.place_bet("Ana", BetType.COLOR, "RED", 40)
        # Balance is not debited at placement time.
        self.assertEqual(self.game.players["Ana"].balance, 100)

    def test_place_bet_validation(self) -> None:
        self.game.add_player("Ana", 100)
        with self.assertRaises(ValueError):
            self.game.place_bet("Ghost", BetType.STRAIGHT, 15, 10)
        with self.assertRaises(ValueError):
            self.game.place_bet("Ana", BetType.STRAIGHT, 15, 0)
        with self.assertRaises(ValueError):
            self.game.place_bet("Ana", BetType.STRAIGHT, 99, 10)
        with self.assertRaises(ValueError):
            self.game.place_bet("Ana", "STRAIGHT", 15, 10)  # type: ignore[arg-type]

    def test_bet_ids_are_incremental(self) -> None:
        self.game.add_player("Ana", 100)
        first = self.game.place_bet("Ana", BetType.STRAIGHT, 1, 10)
        second = self.game.place_bet("Ana", BetType.STRAIGHT, 2, 10)
        self.assertEqual(second.id, first.id + 1)

    def test_cancel_bet(self) -> None:
        self.game.add_player("Ana", 100)
        bet = self.game.place_bet("Ana", BetType.STRAIGHT, 15, 10)
        self.assertIs(self.game.cancel_bet(bet.id), bet)
        self.assertEqual(self.game.pending_bets, [])
        with self.assertRaises(ValueError):
            self.game.cancel_bet(bet.id)

    def test_spin_rejects_bad_steps(self) -> None:
        for bad in (-1, 2.5, "5", True):
            with self.assertRaises(ValueError):
                self.game.spin(wheel_steps=bad)  # type: ignore[arg-type]
            with self.assertRaises(ValueError):
                self.game.spin(ball_steps=bad)  # type: ignore[arg-type]

    def test_spin_with_seeded_rng(self) -> None:
        outcome = self.game.spin(rng=random.Random(7))
        self.assertIsInstance(outcome, SpinOutcome)
        self.assertTrue(37 <= outcome.wheel_steps <= 185)
        self.assertTrue(37 <= outcome.ball_steps <= 185)
        self.assertEqual(outcome.wheel_steps % 37, outcome.effective_wheel_steps)
        self.assertEqual(outcome.ball_steps % 37, outcome.effective_ball_steps)
        self.assertEqual(self.game.round_number, 1)

    def test_reset(self) -> None:
        self.game.add_player("Ana", 100)
        self.game.spin(wheel_steps=5, ball_steps=3)
        self.game.reset()
        self.assertEqual(self.game.players, {})
        self.assertEqual(self.game.pending_bets, [])
        self.assertEqual(self.game.round_number, 0)
        self.assertEqual(self.game.history.newest_first(), [])
        self.assertEqual(self.game.wheel.marker.value.number, 0)


class TestReferenceScenario(unittest.TestCase):
    """The exact reference scenario from ARCHITECTURE.md section 7."""

    def test_three_spin_scenario(self) -> None:
        game = RouletteGame()
        game.add_player("Ana", 100)
        game.add_player("Luis", 100)

        # --- Spin 1: Ana STRAIGHT 15 (10), Luis COLOR RED (20) -----------
        game.place_bet("Ana", BetType.STRAIGHT, 15, 10)
        game.place_bet("Luis", BetType.COLOR, "RED", 20)
        outcome1 = game.spin(wheel_steps=5, ball_steps=3)

        self.assertEqual(outcome1.marker_before.number, 0)
        self.assertEqual(outcome1.marker_after.number, 21)
        self.assertEqual([p.number for p in outcome1.wheel_path], [32, 15, 19, 4, 21])
        self.assertEqual([p.number for p in outcome1.ball_path], [4, 19, 15])
        self.assertEqual(outcome1.result.number, 15)
        self.assertEqual(outcome1.result.color, Color.BLACK)
        self.assertEqual(game.players["Ana"].balance, 450)
        self.assertEqual(game.players["Luis"].balance, 80)
        # Settlements carry bet, won, delta and the resulting balance.
        s1 = outcome1.settlements
        self.assertEqual(len(s1), 2)
        self.assertTrue(all(isinstance(s, Settlement) for s in s1))
        ana_s1, luis_s1 = s1
        self.assertEqual((ana_s1.won, ana_s1.delta, ana_s1.balance_after), (True, 350, 450))
        self.assertEqual((luis_s1.won, luis_s1.delta, luis_s1.balance_after), (False, -20, 80))
        # Bets are consumed by the spin.
        self.assertEqual(game.pending_bets, [])

        # --- Spin 2: Ana NEIGHBORS 6 (10), Luis PARITY EVEN (20) ---------
        game.place_bet("Ana", BetType.NEIGHBORS, 6, 10)
        game.place_bet("Luis", BetType.PARITY, "EVEN", 20)
        outcome2 = game.spin(wheel_steps=10, ball_steps=6)

        self.assertEqual(outcome2.marker_before.number, 21)
        self.assertEqual(outcome2.marker_after.number, 30)
        self.assertEqual(outcome2.result.number, 34)
        self.assertEqual(outcome2.result.color, Color.RED)
        self.assertEqual(game.players["Ana"].balance, 510)
        self.assertEqual(game.players["Luis"].balance, 100)
        ana_s2, luis_s2 = outcome2.settlements
        self.assertEqual((ana_s2.won, ana_s2.delta, ana_s2.balance_after), (True, 60, 510))
        self.assertEqual((luis_s2.won, luis_s2.delta, luis_s2.balance_after), (True, 20, 100))

        # --- Spin 3: Ana DOZEN 1 (10), Luis COLOR RED (50) ---------------
        game.place_bet("Ana", BetType.DOZEN, 1, 10)
        game.place_bet("Luis", BetType.COLOR, "RED", 50)
        outcome3 = game.spin(wheel_steps=40, ball_steps=38)

        self.assertEqual(outcome3.effective_wheel_steps, 3)
        self.assertEqual(outcome3.effective_ball_steps, 1)
        self.assertEqual(outcome3.marker_before.number, 30)
        self.assertEqual(outcome3.marker_after.number, 10)
        self.assertEqual([p.number for p in outcome3.wheel_path], [8, 23, 10])
        self.assertEqual([p.number for p in outcome3.ball_path], [23])
        self.assertEqual(outcome3.result.number, 23)
        self.assertEqual(outcome3.result.color, Color.RED)
        self.assertEqual(game.players["Ana"].balance, 500)
        self.assertEqual(game.players["Luis"].balance, 150)
        ana_s3, luis_s3 = outcome3.settlements
        self.assertEqual((ana_s3.won, ana_s3.delta, ana_s3.balance_after), (False, -10, 500))
        self.assertEqual((luis_s3.won, luis_s3.delta, luis_s3.balance_after), (True, 50, 150))

        # --- History after the three spins -------------------------------
        self.assertEqual(
            [p.number for p in game.history.newest_first()], [23, 34, 15]
        )
        self.assertEqual(
            [p.number for p in game.history.oldest_first()], [15, 34, 23]
        )
        self.assertEqual(game.round_number, 3)

    def test_history_cursor_via_game(self) -> None:
        game = RouletteGame()
        game.spin(wheel_steps=5, ball_steps=3)  # result 15
        game.spin(wheel_steps=10, ball_steps=6)  # result 34
        # Cursor sits on the newest result and wraps around the ring.
        self.assertEqual(game.history.cursor.number, 34)  # type: ignore[union-attr]
        self.assertEqual(game.move_history_cursor("older").number, 15)
        self.assertEqual(game.move_history_cursor("older").number, 34)  # wrapped
        self.assertEqual(game.move_history_cursor("newer").number, 15)


if __name__ == "__main__":
    unittest.main()
