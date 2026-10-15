"""A player at the roulette table."""

from dataclasses import dataclass


@dataclass
class Player:
    """Mutable player: the balance changes as bets are settled."""

    name: str
    balance: int
