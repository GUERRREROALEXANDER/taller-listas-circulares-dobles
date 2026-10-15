"""Facade that ties players, bets, the wheel and the history together."""

from __future__ import annotations

import random
from dataclasses import dataclass

from roulette.game import payout
from roulette.game.spin_history import SpinHistory
from roulette.game.wheel import Wheel
from roulette.models.bet import Bet, BetType, BetValue
from roulette.models.player import Player
from roulette.models.pocket import Pocket

#: A random spin rolls each pointer between 37 (one full lap) and 185 (5 laps).
MIN_SPIN_STEPS = 37
MAX_SPIN_STEPS = 185


@dataclass(frozen=True)
class Settlement:
    """The outcome of a single bet after a spin."""

    bet: Bet
    won: bool
    delta: int
    balance_after: int


@dataclass(frozen=True)
class SpinOutcome:
    """Everything a spin produced, for animation and settlement.

    ``wheel_path`` follows ``next`` links from the old marker; ``ball_path``
    follows ``previous`` links from the new marker. ``effective_*_steps`` are
    the raw steps modulo 37 (what the list actually walked).
    """

    wheel_steps: int
    ball_steps: int
    effective_wheel_steps: int
    effective_ball_steps: int
    marker_before: Pocket
    marker_after: Pocket
    wheel_path: list[Pocket]
    ball_path: list[Pocket]
    result: Pocket
    settlements: list[Settlement]


class RouletteGame:
    """Owns the wheel, the history, the players and the pending bets."""

    def __init__(self, history_capacity: int = 10) -> None:
        self.wheel: Wheel = Wheel()
        self.history: SpinHistory = SpinHistory(history_capacity)
        self.players: dict[str, Player] = {}  # insertion ordered, key = name
        self.pending_bets: list[Bet] = []
        self.round_number: int = 0
        self._next_bet_id: int = 1

    # ------------------------------------------------------------------
    # Players
    # ------------------------------------------------------------------
    def add_player(self, name: str, balance: int) -> Player:
        """Register a player. Duplicate names (case-insensitive) are rejected."""
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name must be a non-empty string")
        if isinstance(balance, bool) or not isinstance(balance, int) or balance < 0:
            raise ValueError("balance must be a non-negative int")
        name = name.strip()
        if any(existing.lower() == name.lower() for existing in self.players):
            raise ValueError(f"a player named {name!r} already exists")
        player = Player(name=name, balance=balance)
        self.players[name] = player
        return player

    def remove_player(self, name: str) -> Player:
        """Remove a player and drop their pending bets."""
        player = self._require_player(name)
        self.pending_bets = [b for b in self.pending_bets if b.player != player.name]
        del self.players[player.name]
        return player

    def _require_player(self, name: str) -> Player:
        player = self.players.get(name)
        if player is None:
            raise ValueError(f"unknown player: {name!r}")
        return player

    # ------------------------------------------------------------------
    # Bets
    # ------------------------------------------------------------------
    def place_bet(self, player: str, bet_type: BetType, value: BetValue, amount: int) -> Bet:
        """Place a bet. Balance is not debited; it only must cover the risk.

        Requires ``balance >= amount + sum(player's pending bets)`` so every
        pending bet can always be settled on a loss.
        """
        if not isinstance(bet_type, BetType):
            raise ValueError("bet_type must be a BetType")
        target = self._require_player(player)
        committed = sum(b.amount for b in self.pending_bets if b.player == target.name)
        if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
            raise ValueError("amount must be a positive int")
        if target.balance < amount + committed:
            raise ValueError(
                f"insufficient balance: {target.balance} < {amount} + {committed} committed"
            )
        bet = Bet(id=self._next_bet_id, player=target.name, bet_type=bet_type,
                  value=value, amount=amount)
        self._next_bet_id += 1
        self.pending_bets.append(bet)
        return bet

    def cancel_bet(self, bet_id: int) -> Bet:
        """Remove a pending bet by id."""
        for index, bet in enumerate(self.pending_bets):
            if bet.id == bet_id:
                return self.pending_bets.pop(index)
        raise ValueError(f"unknown bet id: {bet_id!r}")

    # ------------------------------------------------------------------
    # Spinning
    # ------------------------------------------------------------------
    def spin(
        self,
        wheel_steps: int | None = None,
        ball_steps: int | None = None,
        rng: random.Random | None = None,
    ) -> SpinOutcome:
        """Spin the wheel and launch the ball, settle all pending bets.

        When steps are omitted they are drawn from ``rng`` (or the global
        :mod:`random` module) as ``randint(37, 185)`` each.
        """
        source = rng if rng is not None else random  # module exposes randint too
        if wheel_steps is None:
            wheel_steps = source.randint(MIN_SPIN_STEPS, MAX_SPIN_STEPS)
        if ball_steps is None:
            ball_steps = source.randint(MIN_SPIN_STEPS, MAX_SPIN_STEPS)
        self._validate_steps(wheel_steps, "wheel_steps")
        self._validate_steps(ball_steps, "ball_steps")

        marker_before = self.wheel.marker.value
        wheel_path = self.wheel.spin_wheel(wheel_steps)  # marker advances (next)
        result, ball_path = self.wheel.launch_ball(ball_steps)  # ball walks back
        marker_after = self.wheel.marker.value

        settlements: list[Settlement] = []
        for bet in self.pending_bets:
            won, delta = payout.settle(bet, result, self.wheel)
            player = self.players[bet.player]
            player.balance += delta
            settlements.append(
                Settlement(bet=bet, won=won, delta=delta, balance_after=player.balance)
            )
        self.pending_bets.clear()

        self.history.record(result)
        self.round_number += 1

        return SpinOutcome(
            wheel_steps=wheel_steps,
            ball_steps=ball_steps,
            effective_wheel_steps=wheel_steps % self.wheel.size,
            effective_ball_steps=ball_steps % self.wheel.size,
            marker_before=marker_before,
            marker_after=marker_after,
            wheel_path=wheel_path,
            ball_path=ball_path,
            result=result,
            settlements=settlements,
        )

    @staticmethod
    def _validate_steps(steps: int, name: str) -> None:
        if isinstance(steps, bool) or not isinstance(steps, int) or steps < 0:
            raise ValueError(f"{name} must be a non-negative int")

    # ------------------------------------------------------------------
    # History and lifecycle
    # ------------------------------------------------------------------
    def move_history_cursor(self, direction: str) -> Pocket:
        """Move the history cursor ("older"/"newer"); see :class:`SpinHistory`."""
        return self.history.move_cursor(direction)

    def reset(self) -> None:
        """Back to a fresh table: new wheel, empty history, no players or bets."""
        self.wheel = Wheel()
        self.history = SpinHistory(self.history.capacity)
        self.players = {}
        self.pending_bets = []
        self.round_number = 0
        self._next_bet_id = 1
