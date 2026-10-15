"""Bet types and the :class:`Bet` dataclass."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING, Union

if TYPE_CHECKING:  # avoid a runtime import cycle: models must not import game
    from roulette.game.wheel import Wheel

# RED_NUMBERS mirrors the wheel definition so models stay game-layer free.
RED_NUMBERS: frozenset[int] = frozenset(
    {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
)
BLACK_NUMBERS: frozenset[int] = frozenset(set(range(1, 37)) - RED_NUMBERS)


class BetType(Enum):
    """The kinds of bets the table accepts."""

    STRAIGHT = "STRAIGHT"  # value: int 0..36
    COLOR = "COLOR"  # value: "RED" | "BLACK"
    PARITY = "PARITY"  # value: "EVEN" | "ODD"
    DOZEN = "DOZEN"  # value: 1 | 2 | 3
    NEIGHBORS = "NEIGHBORS"  # value: int 0..36 (center number on the wheel)


BetValue = Union[int, str]


@dataclass
class Bet:
    """A pending bet placed by a player.

    ``id`` is assigned by the game (incremental). ``amount`` must be a
    positive int and ``value`` must match the kind of bet.
    """

    id: int
    player: str
    bet_type: BetType
    value: BetValue
    amount: int

    def __post_init__(self) -> None:
        if isinstance(self.amount, bool) or not isinstance(self.amount, int) or self.amount <= 0:
            raise ValueError("amount must be a positive int")
        self._validate_value()

    def _validate_value(self) -> None:
        """Check that ``value`` is legal for ``bet_type``."""
        if self.bet_type in (BetType.STRAIGHT, BetType.NEIGHBORS):
            if (
                isinstance(self.value, bool)
                or not isinstance(self.value, int)
                or not 0 <= self.value <= 36
            ):
                raise ValueError(f"{self.bet_type.name} value must be an int in 0..36")
        elif self.bet_type is BetType.COLOR:
            if self.value not in ("RED", "BLACK"):
                raise ValueError("COLOR value must be 'RED' or 'BLACK'")
        elif self.bet_type is BetType.PARITY:
            if self.value not in ("EVEN", "ODD"):
                raise ValueError("PARITY value must be 'EVEN' or 'ODD'")
        elif self.bet_type is BetType.DOZEN:
            if self.value not in (1, 2, 3) or isinstance(self.value, bool):
                raise ValueError("DOZEN value must be 1, 2 or 3")

    def covered_numbers(self, wheel: Wheel) -> list[int]:
        """Numbers this bet wins on (used by the UI to highlight pockets)."""
        if self.bet_type is BetType.STRAIGHT:
            return [int(self.value)]
        if self.bet_type is BetType.COLOR:
            return sorted(RED_NUMBERS if self.value == "RED" else BLACK_NUMBERS)
        if self.bet_type is BetType.PARITY:
            return [n for n in range(1, 37) if (n % 2 == 0) == (self.value == "EVEN")]
        if self.bet_type is BetType.DOZEN:
            start = (int(self.value) - 1) * 12 + 1
            return list(range(start, start + 12))
        # NEIGHBORS: the wheel owns the physical order of pockets.
        return [p.number for p in wheel.neighbors(int(self.value))]
