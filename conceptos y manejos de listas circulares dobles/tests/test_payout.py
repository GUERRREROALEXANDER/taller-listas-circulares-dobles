"""Unit tests for bet evaluation and payouts."""

from __future__ import annotations

import unittest

from roulette.game.payout import PAYOUT_MULTIPLIERS, settle
from roulette.game.wheel import Wheel
from roulette.models.bet import Bet, BetType


def make_bet(bet_type: BetType, value, amount: int = 10) -> Bet:
    return Bet(id=1, player="Test", bet_type=bet_type, value=value, amount=amount)


class TestBetValidation(unittest.TestCase):
    def test_amount_must_be_positive_int(self) -> None:
        for bad in (0, -5, 2.5, "10", True):
            with self.assertRaises(ValueError):
                make_bet(BetType.STRAIGHT, 15, bad)

    def test_straight_value_range(self) -> None:
        for bad in (-1, 37, "15", True):
            with self.assertRaises(ValueError):
                make_bet(BetType.STRAIGHT, bad)
        make_bet(BetType.STRAIGHT, 0)
        make_bet(BetType.STRAIGHT, 36)

    def test_color_value(self) -> None:
        make_bet(BetType.COLOR, "RED")
        make_bet(BetType.COLOR, "BLACK")
        for bad in ("GREEN", 1, "red"):
            with self.assertRaises(ValueError):
                make_bet(BetType.COLOR, bad)

    def test_parity_value(self) -> None:
        make_bet(BetType.PARITY, "EVEN")
        make_bet(BetType.PARITY, "ODD")
        with self.assertRaises(ValueError):
            make_bet(BetType.PARITY, "PAIR")

    def test_dozen_value(self) -> None:
        for good in (1, 2, 3):
            make_bet(BetType.DOZEN, good)
        for bad in (0, 4, "1"):
            with self.assertRaises(ValueError):
                make_bet(BetType.DOZEN, bad)


class TestCoveredNumbers(unittest.TestCase):
    def setUp(self) -> None:
        self.wheel = Wheel()

    def test_straight(self) -> None:
        self.assertEqual(make_bet(BetType.STRAIGHT, 15).covered_numbers(self.wheel), [15])

    def test_color(self) -> None:
        red = make_bet(BetType.COLOR, "RED").covered_numbers(self.wheel)
        self.assertEqual(len(red), 18)
        self.assertIn(32, red)
        black = make_bet(BetType.COLOR, "BLACK").covered_numbers(self.wheel)
        self.assertEqual(len(black), 18)
        self.assertIn(15, black)

    def test_parity(self) -> None:
        even = make_bet(BetType.PARITY, "EVEN").covered_numbers(self.wheel)
        self.assertEqual(even, list(range(2, 37, 2)))
        odd = make_bet(BetType.PARITY, "ODD").covered_numbers(self.wheel)
        self.assertEqual(odd, list(range(1, 37, 2)))

    def test_dozen(self) -> None:
        self.assertEqual(
            make_bet(BetType.DOZEN, 2).covered_numbers(self.wheel), list(range(13, 25))
        )

    def test_neighbors(self) -> None:
        self.assertEqual(
            make_bet(BetType.NEIGHBORS, 6).covered_numbers(self.wheel),
            [17, 34, 6, 27, 13],
        )


class TestSettle(unittest.TestCase):
    def setUp(self) -> None:
        self.wheel = Wheel()

    def test_multipliers(self) -> None:
        self.assertEqual(PAYOUT_MULTIPLIERS[BetType.STRAIGHT], 35)
        self.assertEqual(PAYOUT_MULTIPLIERS[BetType.COLOR], 1)
        self.assertEqual(PAYOUT_MULTIPLIERS[BetType.PARITY], 1)
        self.assertEqual(PAYOUT_MULTIPLIERS[BetType.DOZEN], 2)
        self.assertEqual(PAYOUT_MULTIPLIERS[BetType.NEIGHBORS], 6)

    def test_straight_win_and_loss(self) -> None:
        bet = make_bet(BetType.STRAIGHT, 15, 10)
        self.assertEqual(settle(bet, self.wheel.pocket(15), self.wheel), (True, 350))
        self.assertEqual(settle(bet, self.wheel.pocket(16), self.wheel), (False, -10))

    def test_color_zero_always_loses(self) -> None:
        bet = make_bet(BetType.COLOR, "RED", 20)
        self.assertEqual(settle(bet, self.wheel.pocket(0), self.wheel), (False, -20))
        self.assertEqual(settle(bet, self.wheel.pocket(34), self.wheel), (True, 20))

    def test_parity_zero_always_loses(self) -> None:
        bet = make_bet(BetType.PARITY, "EVEN", 20)
        self.assertEqual(settle(bet, self.wheel.pocket(0), self.wheel), (False, -20))
        self.assertEqual(settle(bet, self.wheel.pocket(34), self.wheel), (True, 20))
        self.assertEqual(settle(bet, self.wheel.pocket(23), self.wheel), (False, -20))

    def test_dozen(self) -> None:
        bet = make_bet(BetType.DOZEN, 1, 10)
        self.assertEqual(settle(bet, self.wheel.pocket(23), self.wheel), (False, -10))
        self.assertEqual(settle(bet, self.wheel.pocket(5), self.wheel), (True, 20))
        self.assertEqual(settle(bet, self.wheel.pocket(0), self.wheel), (False, -10))

    def test_neighbors_uses_wheel_order(self) -> None:
        bet = make_bet(BetType.NEIGHBORS, 6, 10)
        # 34 sits next to 6 on the wheel (see ARCHITECTURE section 7, spin 2).
        self.assertEqual(settle(bet, self.wheel.pocket(34), self.wheel), (True, 60))
        self.assertEqual(settle(bet, self.wheel.pocket(7), self.wheel), (False, -10))


if __name__ == "__main__":
    unittest.main()
