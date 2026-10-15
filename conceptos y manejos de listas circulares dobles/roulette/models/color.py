"""Pocket colors on a European roulette wheel."""

from enum import Enum


class Color(Enum):
    """The three possible pocket colors."""

    RED = "RED"
    BLACK = "BLACK"
    GREEN = "GREEN"
