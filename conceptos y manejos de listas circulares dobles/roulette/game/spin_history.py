"""Fixed-capacity spin history implemented as a ring buffer on the list.

Once the ring is full, :meth:`record` reuses the oldest node instead of
allocating a new one: the list reaches ``capacity`` nodes and never grows.
That is the classic circular-buffer trick, here done with real pointers.
"""

from __future__ import annotations

from roulette.data_structures.circular_doubly_linked_list import (
    CircularDoublyLinkedList,
    Direction,
)
from roulette.data_structures.node import Node
from roulette.models.pocket import Pocket


class SpinHistory:
    """Keeps the last ``capacity`` spin results, newest at ``latest``.

    Layout invariant: starting from ``latest`` and following ``previous``
    walks results newest-to-oldest; following ``next`` walks oldest-to-newest.
    """

    def __init__(self, capacity: int = 10) -> None:
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity <= 0:
            raise ValueError("capacity must be a positive int")
        self.capacity: int = capacity
        self._ring: CircularDoublyLinkedList[Pocket] = CircularDoublyLinkedList()
        self.latest: Node[Pocket] | None = None
        self._cursor: Node[Pocket] | None = None

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------
    def record(self, pocket: Pocket) -> None:
        """Store ``pocket`` as the newest result.

        Not full -> append a node. Full -> overwrite the oldest node
        (``latest.next``) in place and rotate ``latest`` onto it; no new
        node is allocated. The cursor resets to the newest entry.
        """
        if self._ring.size < self.capacity:
            self.latest = self._ring.append(pocket)
        else:
            assert self.latest is not None
            oldest = self.latest.next  # oldest is always right after latest
            oldest.value = pocket  # overwrite instead of unlink/append
            self.latest = oldest
        self._cursor = self.latest

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------
    @property
    def size(self) -> int:
        """How many results are stored (0..capacity)."""
        return self._ring.size

    @property
    def cursor(self) -> Pocket | None:
        """Pocket under the UI cursor, or ``None`` when the history is empty."""
        return self._cursor.value if self._cursor is not None else None

    def newest_first(self) -> list[Pocket]:
        """Results from newest to oldest (walk ``previous`` from ``latest``)."""
        if self.latest is None:
            return []
        return [node.value for node in self._ring.nodes(self.latest, Direction.BACKWARD)]

    def oldest_first(self) -> list[Pocket]:
        """Results from oldest to newest (walk ``next`` from the oldest node)."""
        if self.latest is None:
            return []
        oldest = self.latest.next
        return [node.value for node in self._ring.nodes(oldest)]

    def stats(self) -> dict[str, int]:
        """Color counts over the stored results."""
        counts = {"RED": 0, "BLACK": 0, "GREEN": 0}
        for pocket in self._ring:
            counts[pocket.color.name] += 1
        return counts

    # ------------------------------------------------------------------
    # Cursor navigation
    # ------------------------------------------------------------------
    def move_cursor(self, direction: str) -> Pocket:
        """Move the UI cursor one step; wraps around (it is a ring, after all).

        ``"older"`` follows ``previous``, ``"newer"`` follows ``next``.
        Raises :class:`IndexError` on an empty history.
        """
        if self._cursor is None:
            raise IndexError("cannot move the cursor of an empty history")
        if direction == "older":
            self._cursor = self._cursor.previous
        elif direction == "newer":
            self._cursor = self._cursor.next
        else:
            raise ValueError("direction must be 'older' or 'newer'")
        return self._cursor.value

    def clear(self) -> None:
        """Forget every result."""
        self._ring.clear()
        self.latest = None
        self._cursor = None
