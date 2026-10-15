"""Unit tests for CircularDoublyLinkedList."""

from __future__ import annotations

import unittest

from roulette.data_structures.circular_doubly_linked_list import (
    CircularDoublyLinkedList,
    Direction,
)


class TestEmptyList(unittest.TestCase):
    def setUp(self) -> None:
        self.lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()

    def test_starts_empty(self) -> None:
        self.assertTrue(self.lst.is_empty())
        self.assertEqual(len(self.lst), 0)
        self.assertIsNone(self.lst.head)
        self.assertIsNone(self.lst.tail)
        self.assertEqual(list(self.lst), [])

    def test_empty_operations_raise_index_error(self) -> None:
        with self.assertRaises(IndexError):
            self.lst.step(self.lst.head, 1)  # type: ignore[arg-type]
        with self.assertRaises(IndexError):
            self.lst.remove_node(self.lst.head)  # type: ignore[arg-type]

    def test_find_on_empty_returns_none(self) -> None:
        self.assertIsNone(self.lst.find(lambda v: True))

    def test_remove_missing_value_raises(self) -> None:
        with self.assertRaises(ValueError):
            self.lst.remove(42)


class TestInsertions(unittest.TestCase):
    def test_single_node_points_to_itself(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        node = lst.append(1)
        self.assertIs(node.next, node)
        self.assertIs(node.previous, node)
        self.assertIs(lst.head, node)
        self.assertIs(lst.tail, node)
        lst.check_integrity()

    def test_append_builds_tail(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        for value in (1, 2, 3):
            lst.append(value)
        self.assertEqual(list(lst), [1, 2, 3])
        self.assertEqual(lst.tail.value, 3)  # type: ignore[union-attr]
        # Circularity: tail.next is head, head.previous is tail.
        self.assertIs(lst.tail.next, lst.head)  # type: ignore[union-attr]
        lst.check_integrity()

    def test_prepend_moves_head(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        lst.append(2)
        lst.append(3)
        node = lst.prepend(1)
        self.assertIs(lst.head, node)
        self.assertEqual(list(lst), [1, 2, 3])
        lst.check_integrity()

    def test_insert_after(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        first = lst.append(1)
        lst.append(3)
        lst.insert_after(first, 2)
        self.assertEqual(list(lst), [1, 2, 3])
        lst.check_integrity()

    def test_insert_after_tail_updates_ring(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        lst.append(1)
        tail = lst.append(2)
        lst.insert_after(tail, 3)
        self.assertEqual(lst.tail.value, 3)  # type: ignore[union-attr]
        self.assertEqual(list(lst), [1, 2, 3])
        lst.check_integrity()


class TestRemovals(unittest.TestCase):
    def setUp(self) -> None:
        self.lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        for value in (1, 2, 3):
            self.lst.append(value)

    def test_remove_node_unlinks(self) -> None:
        middle = self.lst.head.next  # type: ignore[union-attr]
        value = self.lst.remove_node(middle)
        self.assertEqual(value, 2)
        self.assertEqual(list(self.lst), [1, 3])
        # Removed node is detached (points to itself).
        self.assertIs(middle.next, middle)
        self.assertIs(middle.previous, middle)
        self.lst.check_integrity()

    def test_remove_head_moves_head(self) -> None:
        self.lst.remove_node(self.lst.head)  # type: ignore[arg-type]
        self.assertEqual(self.lst.head.value, 2)  # type: ignore[union-attr]
        self.assertEqual(list(self.lst), [2, 3])
        self.lst.check_integrity()

    def test_remove_last_node_empties_list(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        node = lst.append(7)
        self.assertEqual(lst.remove_node(node), 7)
        self.assertTrue(lst.is_empty())
        self.assertIsNone(lst.head)
        lst.check_integrity()

    def test_remove_by_value(self) -> None:
        self.assertEqual(self.lst.remove(3), 3)
        self.assertEqual(list(self.lst), [1, 2])
        with self.assertRaises(ValueError):
            self.lst.remove(99)
        self.lst.check_integrity()


class TestMovementAndSearch(unittest.TestCase):
    def setUp(self) -> None:
        self.lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        for value in (10, 20, 30, 40):
            self.lst.append(value)
        self.lst.check_integrity()

    def test_find(self) -> None:
        node = self.lst.find(lambda v: v == 30)
        self.assertIsNotNone(node)
        self.assertEqual(node.value, 30)  # type: ignore[union-attr]
        self.assertIsNone(self.lst.find(lambda v: v == 99))

    def test_step_modulo_size(self) -> None:
        head = self.lst.head
        # 6 steps on a 4-node list == 2 steps.
        self.assertEqual(self.lst.step(head, 6).value, 30)  # type: ignore[arg-type]
        self.assertEqual(self.lst.step(head, 0).value, 10)  # type: ignore[arg-type]
        self.assertEqual(
            self.lst.step(head, 1, Direction.BACKWARD).value, 40  # type: ignore[arg-type]
        )

    def test_step_negative_raises(self) -> None:
        with self.assertRaises(ValueError):
            self.lst.step(self.lst.head, -1)  # type: ignore[arg-type]

    def test_walk_returns_visited_excluding_start(self) -> None:
        head = self.lst.head
        visited = self.lst.walk(head, 3)  # type: ignore[arg-type]
        self.assertEqual([n.value for n in visited], [20, 30, 40])
        backward = self.lst.walk(head, 2, Direction.BACKWARD)  # type: ignore[arg-type]
        self.assertEqual([n.value for n in backward], [40, 30])

    def test_traverse_directions_and_start(self) -> None:
        head = self.lst.head
        self.assertEqual(list(self.lst.traverse()), [10, 20, 30, 40])
        self.assertEqual(
            list(self.lst.traverse(head, Direction.BACKWARD)), [10, 40, 30, 20]
        )
        second = head.next  # type: ignore[union-attr]
        self.assertEqual(list(self.lst.traverse(second)), [20, 30, 40, 10])

    def test_nodes_yields_node_objects(self) -> None:
        nodes = list(self.lst.nodes())
        self.assertEqual([n.value for n in nodes], [10, 20, 30, 40])

    def test_contains(self) -> None:
        self.assertIn(30, self.lst)
        self.assertNotIn(99, self.lst)


class TestMaintenance(unittest.TestCase):
    def test_clear(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        lst.append(1)
        lst.append(2)
        lst.clear()
        self.assertTrue(lst.is_empty())
        self.assertIsNone(lst.head)
        lst.check_integrity()

    def test_repr(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        lst.append(1)
        lst.append(2)
        self.assertEqual(repr(lst), "CircularDoublyLinkedList([1, 2])")

    def test_check_integrity_detects_size_mismatch(self) -> None:
        lst: CircularDoublyLinkedList[int] = CircularDoublyLinkedList()
        lst.append(1)
        lst.size = 5  # corrupt the counter on purpose
        with self.assertRaises(AssertionError):
            lst.check_integrity()


if __name__ == "__main__":
    unittest.main()
