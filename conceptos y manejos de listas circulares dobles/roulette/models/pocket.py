"""A single pocket of the roulette wheel."""

from dataclasses import dataclass

from roulette.models.color import Color


@dataclass(frozen=True)
class Pocket:
    """Immutable value stored in each wheel node: a number and its color."""

    number: int
    color: Color
