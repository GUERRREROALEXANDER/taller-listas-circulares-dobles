"""Generic circular doubly linked list.

The list has no ``None`` pointers: the tail's ``next`` is the head and the
head's ``previous`` is the tail, so traversal wraps around forever. That
circularity is exactly what a roulette wheel and a ring-buffer history need.

Pointer cheat sheet used by every insertion/removal below::

    a <-> c          becomes          a <-> b <-> c
    a.next = b ; b.previous = a  (stitch b between a and c)
    b.next = c ; c.previous = b

Four assignments splice a node in; four more splice it out. All are O(1)
because no shifting is needed — we only rewire neighbors.
"""

from __future__ import annotations

from enum import Enum
from typing import Callable, Generic, Iterator, TypeVar

from roulette.data_structures.node import Node

T = TypeVar("T")


class Direction(Enum):
    """Traversal direction: ``FORWARD`` follows ``next``, ``BACKWARD`` follows ``previous``."""

    FORWARD = "forward"
    BACKWARD = "backward"


class CircularDoublyLinkedList(Generic[T]):
    """A circular doubly linked list with a ``head`` pointer and a ``size`` counter."""

    def __init__(self) -> None:
        self.head: Node[T] | None = None
        self.size: int = 0

    # ------------------------------------------------------------------
    # Basic accessors
    # ------------------------------------------------------------------
    @property
    def tail(self) -> Node[T] | None:
        """The node before ``head`` (``head.previous``), or ``None`` when empty."""
        if self.head is None:
            return None
        return self.head.previous

    def is_empty(self) -> bool:
        """Return ``True`` when the list holds no nodes."""
        return self.size == 0

    def __len__(self) -> int:
        return self.size

    def _require_head(self) -> Node[T]:
        """Return ``head`` or raise :class:`IndexError` on an empty list."""
        if self.head is None:
            raise IndexError("operation not allowed on an empty list")
        return self.head

    # ------------------------------------------------------------------
    # Insertions
    # ------------------------------------------------------------------
    def append(self, value: T) -> Node[T]:
        """Insert ``value`` before ``head`` so it becomes the new tail. O(1).

        Pointer work: splice the new node between the current tail and head.
        """
        new_node: Node[T] = Node(value)
        if self.head is None:
            # First node: it points to itself in both directions.
            self.head = new_node
        else:
            tail = self.head.previous
            # Stitch tail -> new_node -> head.
            new_node.previous = tail
            new_node.next = self.head
            tail.next = new_node
            self.head.previous = new_node
        self.size += 1
        return new_node

    def prepend(self, value: T) -> Node[T]:
        """Insert ``value`` before ``head`` and move ``head`` to it. O(1)."""
        new_node = self.append(value)  # append lands exactly before head
        self.head = new_node  # rotate the entry point to the new node
        return new_node

    def insert_after(self, node: Node[T], value: T) -> Node[T]:
        """Insert ``value`` right after ``node``. O(1).

        Pointer work: ``node <-> nxt`` becomes ``node <-> new <-> nxt``.
        """
        self._require_head()
        new_node: Node[T] = Node(value)
        nxt = node.next
        new_node.previous = node
        new_node.next = nxt
        node.next = new_node
        nxt.previous = new_node
        self.size += 1
        return new_node

    # ------------------------------------------------------------------
    # Removals
    # ------------------------------------------------------------------
    def remove_node(self, node: Node[T]) -> T:
        """Unlink ``node`` from the list and return its value. O(1).

        Pointer work: ``prev <-> node <-> nxt`` becomes ``prev <-> nxt``.
        If ``node`` is the head, the head advances to ``nxt``; if it is the
        last node, the list becomes empty.
        """
        self._require_head()
        value = node.value
        if node.next is node:
            # Single node list: removing it empties the list.
            self.head = None
        else:
            prev = node.previous
            nxt = node.next
            prev.next = nxt
            nxt.previous = prev
            if node is self.head:
                self.head = nxt
        self.size -= 1
        # Defensive cleanup so a detached node cannot corrupt the list later.
        node.next = node
        node.previous = node
        return value

    def remove(self, value: T) -> T:
        """Remove the first node whose value equals ``value``. O(n).

        Raises :class:`ValueError` if the value is not present.
        """
        node = self.find(lambda item: item == value)
        if node is None:
            raise ValueError(f"value not found in list: {value!r}")
        return self.remove_node(node)

    # ------------------------------------------------------------------
    # Search and movement
    # ------------------------------------------------------------------
    def find(self, predicate: Callable[[T], bool]) -> Node[T] | None:
        """First node matching ``predicate``, clockwise from ``head``. O(n).

        Returns ``None`` on an empty list or when nothing matches.
        """
        if self.head is None:
            return None
        start = self.head
        node = start
        while True:  # do/while: always inspect the start node at least once
            if predicate(node.value):
                return node
            node = node.next
            if node is start:
                break
        return None

    def step(self, node: Node[T], steps: int, direction: Direction = Direction.FORWARD) -> Node[T]:
        """Move ``steps`` positions from ``node`` following ``direction``.

        Uses ``steps % size`` so huge step counts cost one short walk instead
        of useless full laps. Negative steps raise :class:`ValueError`.
        """
        if steps < 0:
            raise ValueError("steps must be >= 0")
        self._require_head()
        hops = steps % self.size
        current = node
        for _ in range(hops):
            current = current.next if direction is Direction.FORWARD else current.previous
        return current

    def walk(
        self, node: Node[T], steps: int, direction: Direction = Direction.FORWARD
    ) -> list[Node[T]]:
        """Like :meth:`step` but returns every visited node (excluding the start)."""
        if steps < 0:
            raise ValueError("steps must be >= 0")
        self._require_head()
        hops = steps % self.size
        visited: list[Node[T]] = []
        current = node
        for _ in range(hops):
            current = current.next if direction is Direction.FORWARD else current.previous
            visited.append(current)
        return visited

    # ------------------------------------------------------------------
    # Iteration
    # ------------------------------------------------------------------
    def nodes(
        self, start: Node[T] | None = None, direction: Direction = Direction.FORWARD
    ) -> Iterator[Node[T]]:
        """Yield every node exactly once, starting at ``start`` (default ``head``).

        Uses do/while semantics: the start node is yielded before checking
        whether the lap is complete.
        """
        if self.head is None:
            return
        start_node = start if start is not None else self.head
        node = start_node
        while True:
            yield node
            node = node.next if direction is Direction.FORWARD else node.previous
            if node is start_node:
                break

    def traverse(
        self, start: Node[T] | None = None, direction: Direction = Direction.FORWARD
    ) -> Iterator[T]:
        """Yield every value once around the ring (see :meth:`nodes`)."""
        for node in self.nodes(start, direction):
            yield node.value

    def __iter__(self) -> Iterator[T]:
        return self.traverse()

    def __contains__(self, value: object) -> bool:
        return self.find(lambda item: item == value) is not None

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------
    def clear(self) -> None:
        """Drop every node and reset the list to empty."""
        self.head = None
        self.size = 0

    def check_integrity(self) -> None:
        """Validate link symmetry and the size counter. O(n).

        Raises :class:`AssertionError` if any ``a.next.previous is not a``
        (broken back-pointer) or if the counted lap does not match ``size``.
        """
        if self.head is None:
            assert self.size == 0, "size must be 0 when head is None"
            return
        count = 0
        start = self.head
        node = start
        while True:
            assert node.next.previous is node, f"broken next/previous pair at {node!r}"
            assert node.previous.next is node, f"broken previous/next pair at {node!r}"
            count += 1
            node = node.next
            if node is start:
                break
        assert count == self.size, f"size mismatch: counted {count}, stored {self.size}"

    def __repr__(self) -> str:
        values = ", ".join(repr(v) for v in self)
        return f"CircularDoublyLinkedList([{values}])"
