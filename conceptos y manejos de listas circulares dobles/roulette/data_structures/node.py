"""Node of a doubly linked list.

A node stores a value and two pointers: ``next`` (clockwise) and ``previous``
(counter-clockwise). A freshly created node points to itself in both
directions, which makes it a valid one-element circular list.
"""

from __future__ import annotations

from typing import Generic, TypeVar

T = TypeVar("T")


class Node(Generic[T]):
    """A node holding ``value`` with ``next``/``previous`` self-pointers."""

    __slots__ = ("value", "next", "previous")

    def __init__(self, value: T) -> None:
        self.value: T = value
        self.next: Node[T] = self
        self.previous: Node[T] = self

    def __repr__(self) -> str:
        return f"Node({self.value!r})"
