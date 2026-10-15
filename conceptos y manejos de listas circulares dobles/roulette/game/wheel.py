"""The European roulette wheel, stored ONLY in a CircularDoublyLinkedList.

The physical order of pockets is encoded in the ``next``/``previous`` links,
never in a Python list. Python lists appear only as return values for the UI.
"""

from __future__ import annotations

from roulette.data_structures.circular_doubly_linked_list import (
    CircularDoublyLinkedList,
    Direction,
)
from roulette.data_structures.node import Node
from roulette.models.color import Color
from roulette.models.pocket import Pocket

#: Clockwise European wheel order starting at 0.
EUROPEAN_ORDER: tuple[int, ...] = (
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
)

RED_NUMBERS: frozenset[int] = frozenset(
    {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
)


def color_of(number: int) -> Color:
    """Color of a pocket number: 0 is green, the red set is red, rest black."""
    if number == 0:
        return Color.GREEN
    return Color.RED if number in RED_NUMBERS else Color.BLACK


class Wheel:
    """The wheel: a circular list of :class:`Pocket` plus a fixed table marker.

    ``marker`` is the node currently under the table's pointer; spins move it
    clockwise (``next``) while the ball travels counter-clockwise (``previous``).
    """

    def __init__(self) -> None:
        self._pockets: CircularDoublyLinkedList[Pocket] = CircularDoublyLinkedList()
        for number in EUROPEAN_ORDER:
            self._pockets.append(Pocket(number=number, color=color_of(number)))
        self._pockets.check_integrity()
        self.marker: Node[Pocket] = self._pockets.head  # type: ignore[assignment]

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------
    @property
    def size(self) -> int:
        """Number of pockets (always 37)."""
        return self._pockets.size

    def node_of(self, number: int) -> Node[Pocket]:
        """Node holding pocket ``number``; :class:`ValueError` if not in 0..36."""
        if isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= 36:
            raise ValueError(f"pocket number must be an int in 0..36, got {number!r}")
        node = self._pockets.find(lambda p: p.number == number)
        assert node is not None  # every number 0..36 exists by construction
        return node

    def pocket(self, number: int) -> Pocket:
        """The :class:`Pocket` with the given number."""
        return self.node_of(number).value

    def order(
        self,
        direction: Direction = Direction.FORWARD,
        start: Node[Pocket] | None = None,
    ) -> list[Pocket]:
        """Full lap of pockets from ``start`` (default: the marker)."""
        start_node = start if start is not None else self.marker
        return list(self._pockets.traverse(start_node, direction))

    def neighbors(self, number: int, radius: int = 2) -> list[Pocket]:
        """Pockets around ``number``: ``[prev2, prev1, n, next1, next2]`` for radius 2.

        Because the list is circular, neighbors near the head/tail seam wrap
        around naturally (e.g. neighbors of 0 are ``[3, 26, 0, 32, 15]``).
        """
        if radius < 0:
            raise ValueError("radius must be >= 0")
        center = self.node_of(number)
        result: list[Pocket] = [Pocket(0, Color.GREEN)] * (2 * radius + 1)
        result[radius] = center.value
        node = center
        for i in range(1, radius + 1):
            node = node.previous
            result[radius - i] = node.value
        node = center
        for i in range(1, radius + 1):
            node = node.next
            result[radius + i] = node.value
        return result

    # ------------------------------------------------------------------
    # Spin mechanics
    # ------------------------------------------------------------------
    def spin_wheel(self, steps: int) -> list[Pocket]:
        """Advance the marker ``steps`` positions clockwise; return the path visited.

        The list's :meth:`step` logic reduces ``steps % 37``, so extra full
        laps are free. The marker itself ends on the last visited node.
        """
        if isinstance(steps, bool) or not isinstance(steps, int) or steps < 0:
            raise ValueError("steps must be a non-negative int")
        visited_nodes = self._pockets.walk(self.marker, steps, Direction.FORWARD)
        if visited_nodes:
            self.marker = visited_nodes[-1]
        return [node.value for node in visited_nodes]

    def launch_ball(self, steps: int) -> tuple[Pocket, list[Pocket]]:
        """Walk ``steps`` pockets counter-clockwise from the marker.

        Returns ``(landing_pocket, path)``. The marker does not move: the ball
        is the only thing traveling backwards.
        """
        if isinstance(steps, bool) or not isinstance(steps, int) or steps < 0:
            raise ValueError("steps must be a non-negative int")
        visited_nodes = self._pockets.walk(self.marker, steps, Direction.BACKWARD)
        if not visited_nodes:
            return self.marker.value, []
        return visited_nodes[-1].value, [node.value for node in visited_nodes]
