"""Unit tests for SpinHistory (ring buffer on the circular list)."""

from __future__ import annotations

import unittest

from roulette.game.spin_history import SpinHistory
from roulette.game.wheel import Wheel


class TestSpinHistory(unittest.TestCase):
    def setUp(self) -> None:
        self.wheel = Wheel()
        self.history = SpinHistory(capacity=3)

    def _numbers(self, pockets: list) -> list[int]:
        return [p.number for p in pockets]

    def test_empty_history(self) -> None:
        self.assertEqual(self.history.newest_first(), [])
        self.assertEqual(self.history.oldest_first(), [])
        self.assertIsNone(self.history.cursor)
        self.assertEqual(self.history.stats(), {"RED": 0, "BLACK": 0, "GREEN": 0})
        with self.assertRaises(IndexError):
            self.history.move_cursor("older")

    def test_invalid_capacity(self) -> None:
        for bad in (0, -1, 2.5, "10"):
            with self.assertRaises(ValueError):
                SpinHistory(bad)  # type: ignore[arg-type]

    def test_record_until_full(self) -> None:
        for number in (15, 34, 23):
            self.history.record(self.wheel.pocket(number))
        self.assertEqual(self.history.size, 3)
        self.assertEqual(self._numbers(self.history.newest_first()), [23, 34, 15])
        self.assertEqual(self._numbers(self.history.oldest_first()), [15, 34, 23])

    def test_record_overwrites_oldest_without_growing(self) -> None:
        for number in (15, 34, 23, 6, 0):
            self.history.record(self.wheel.pocket(number))
        # Capacity is 3: only the last three results survive.
        self.assertEqual(self.history.size, 3)
        self.assertEqual(self._numbers(self.history.newest_first()), [0, 6, 23])
        self.assertEqual(self._numbers(self.history.oldest_first()), [23, 6, 0])

    def test_record_never_allocates_once_full(self) -> None:
        for number in (15, 34, 23):
            self.history.record(self.wheel.pocket(number))
        # Capture node identities; overwriting must reuse them.
        nodes_before = [id(n) for n in self.history._ring.nodes()]
        self.history.record(self.wheel.pocket(6))
        nodes_after = [id(n) for n in self.history._ring.nodes()]
        self.assertEqual(sorted(nodes_before), sorted(nodes_after))

    def test_cursor_resets_to_latest_on_record(self) -> None:
        for number in (15, 34):
            self.history.record(self.wheel.pocket(number))
        self.history.move_cursor("older")  # now on 15
        self.history.record(self.wheel.pocket(23))
        self.assertEqual(self.history.cursor.number, 23)  # type: ignore[union-attr]

    def test_cursor_navigation_wraps_around(self) -> None:
        for number in (15, 34, 23):
            self.history.record(self.wheel.pocket(number))
        # Cursor starts at newest (23).
        self.assertEqual(self.history.cursor.number, 23)  # type: ignore[union-attr]
        self.assertEqual(self.history.move_cursor("older").number, 34)
        self.assertEqual(self.history.move_cursor("older").number, 15)
        # One more "older" wraps back to the newest entry (ring semantics).
        self.assertEqual(self.history.move_cursor("older").number, 23)
        self.assertEqual(self.history.move_cursor("newer").number, 15)
        self.assertEqual(self.history.move_cursor("newer").number, 34)

    def test_move_cursor_validates_direction(self) -> None:
        self.history.record(self.wheel.pocket(15))
        with self.assertRaises(ValueError):
            self.history.move_cursor("sideways")

    def test_stats(self) -> None:
        for number in (15, 34, 0):  # black, red, green
            self.history.record(self.wheel.pocket(number))
        self.assertEqual(self.history.stats(), {"RED": 1, "BLACK": 1, "GREEN": 1})

    def test_clear(self) -> None:
        self.history.record(self.wheel.pocket(15))
        self.history.clear()
        self.assertEqual(self.history.newest_first(), [])
        self.assertIsNone(self.history.cursor)


if __name__ == "__main__":
    unittest.main()
