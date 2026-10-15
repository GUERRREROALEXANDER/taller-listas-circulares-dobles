"""Unit tests for the Wheel."""

from __future__ import annotations

import unittest

from roulette.data_structures.circular_doubly_linked_list import Direction
from roulette.game.wheel import EUROPEAN_ORDER, Wheel
from roulette.models.color import Color


class TestWheelStructure(unittest.TestCase):
    def setUp(self) -> None:
        self.wheel = Wheel()

    def test_order_and_head(self) -> None:
        self.assertEqual(self.wheel.size, 37)
        numbers = [p.number for p in self.wheel.order(start=self.wheel.marker)]
        self.assertEqual(list(EUROPEAN_ORDER), numbers)
        # Marker starts at head (0).
        self.assertEqual(self.wheel.marker.value.number, 0)

    def test_colors(self) -> None:
        self.assertEqual(self.wheel.pocket(0).color, Color.GREEN)
        self.assertEqual(self.wheel.pocket(32).color, Color.RED)
        self.assertEqual(self.wheel.pocket(15).color, Color.BLACK)
        self.assertEqual(self.wheel.pocket(26).color, Color.BLACK)

    def test_pocket_lookup_and_errors(self) -> None:
        self.assertEqual(self.wheel.pocket(36).number, 36)
        for bad in (-1, 37, "0", True):
            with self.assertRaises(ValueError):
                self.wheel.pocket(bad)  # type: ignore[arg-type]

    def test_neighbors_crossing_seam(self) -> None:
        self.assertEqual(
            [p.number for p in self.wheel.neighbors(0)], [3, 26, 0, 32, 15]
        )

    def test_neighbors_in_the_middle(self) -> None:
        self.assertEqual(
            [p.number for p in self.wheel.neighbors(21)], [19, 4, 21, 2, 25]
        )

    def test_neighbors_radius_one(self) -> None:
        self.assertEqual(
            [p.number for p in self.wheel.neighbors(6, radius=1)], [34, 6, 27]
        )

    def test_order_backward(self) -> None:
        numbers = [p.number for p in self.wheel.order(Direction.BACKWARD)]
        self.assertEqual(numbers[:3], [0, 26, 3])


class TestWheelSpin(unittest.TestCase):
    def setUp(self) -> None:
        self.wheel = Wheel()

    def test_spin_wheel_moves_marker_and_returns_path(self) -> None:
        path = self.wheel.spin_wheel(5)
        self.assertEqual([p.number for p in path], [32, 15, 19, 4, 21])
        self.assertEqual(self.wheel.marker.value.number, 21)

    def test_spin_wheel_reduces_modulo_37(self) -> None:
        path = self.wheel.spin_wheel(37 + 2)
        self.assertEqual([p.number for p in path], [32, 15])
        self.assertEqual(self.wheel.marker.value.number, 15)

    def test_launch_ball_walks_backwards_without_moving_marker(self) -> None:
        self.wheel.spin_wheel(5)  # marker on 21
        result, path = self.wheel.launch_ball(3)
        self.assertEqual([p.number for p in path], [4, 19, 15])
        self.assertEqual(result.number, 15)
        self.assertEqual(self.wheel.marker.value.number, 21)

    def test_launch_ball_zero_steps_lands_on_marker(self) -> None:
        result, path = self.wheel.launch_ball(37)  # full lap == 0 effective
        self.assertEqual(result.number, 0)
        self.assertEqual(path, [])

    def test_negative_steps_raise(self) -> None:
        with self.assertRaises(ValueError):
            self.wheel.spin_wheel(-1)
        with self.assertRaises(ValueError):
            self.wheel.launch_ball(-2)


if __name__ == "__main__":
    unittest.main()
