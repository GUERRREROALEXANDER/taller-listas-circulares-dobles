"""Serializers: domain objects -> JSON-ready dicts (ARCHITECTURE.md section 5).

The shapes produced here are the API contract; the frontend relies on the
exact key names, so they must match section 5 of docs/ARCHITECTURE.md.
"""

from __future__ import annotations

from typing import Any

from roulette.data_structures.circular_doubly_linked_list import Direction
from roulette.game.roulette_game import RouletteGame, SpinOutcome
from roulette.game.wheel import Wheel
from roulette.models.bet import Bet
from roulette.models.pocket import Pocket


def pocket_json(pocket: Pocket) -> dict[str, Any]:
    """A pocket as ``{"number": int, "color": str}``."""
    return {"number": pocket.number, "color": pocket.color.name}


def _pocket_links_json(wheel: Wheel) -> list[dict[str, Any]]:
    """Every pocket from the head, clockwise, with ``previous``/``next`` links."""
    head = wheel.node_of(0)  # head always holds pocket 0 by construction
    pockets: list[dict[str, Any]] = []
    node = head
    for _ in range(wheel.size):
        pockets.append(
            {
                "number": node.value.number,
                "color": node.value.color.name,
                "previous": node.previous.value.number,
                "next": node.next.value.number,
            }
        )
        node = node.next
    return pockets


def _bet_json(bet: Bet, wheel: Wheel) -> dict[str, Any]:
    """A pending bet including the numbers it covers (for UI highlighting)."""
    return {
        "id": bet.id,
        "player": bet.player,
        "type": bet.bet_type.value,
        "value": bet.value,
        "amount": bet.amount,
        "covered": bet.covered_numbers(wheel),
    }


def game_state_json(game: RouletteGame) -> dict[str, Any]:
    """The full ``GameState`` object of section 5."""
    wheel = game.wheel
    history = game.history
    return {
        "round": game.round_number,
        "wheel": {
            "size": wheel.size,
            "head": wheel.node_of(0).value.number,
            "tail": wheel.node_of(0).previous.value.number,
            "marker": wheel.marker.value.number,
            "pockets": _pocket_links_json(wheel),
        },
        "players": [
            {
                "name": player.name,
                "balance": player.balance,
                "committed": sum(
                    b.amount for b in game.pending_bets if b.player == player.name
                ),
            }
            for player in game.players.values()
        ],
        "pending_bets": [_bet_json(bet, wheel) for bet in game.pending_bets],
        "history": {
            "capacity": history.capacity,
            "size": history.size,
            "results": [pocket_json(p) for p in history.newest_first()],
            "cursor": pocket_json(history.cursor) if history.cursor is not None else None,
            "stats": history.stats(),
        },
    }


def wheel_order_json(wheel: Wheel, direction: Direction, label: str) -> dict[str, Any]:
    """Response of ``GET /api/wheel/order``: a full lap from the marker."""
    return {
        "direction": label,
        "start": wheel.marker.value.number,
        "order": [pocket_json(p) for p in wheel.order(direction)],
    }


def pocket_detail_json(wheel: Wheel, number: int) -> dict[str, Any]:
    """Response of ``GET /api/pockets/<n>`` with links and 5 neighbors."""
    node = wheel.node_of(number)
    return {
        "number": node.value.number,
        "color": node.value.color.name,
        "previous": node.previous.value.number,
        "next": node.next.value.number,
        "neighbors": [p.number for p in wheel.neighbors(number)],
    }


def spin_outcome_json(outcome: SpinOutcome, game: RouletteGame) -> dict[str, Any]:
    """The ``SpinOutcome`` object of section 5 (paths as plain numbers)."""
    return {
        "wheel_steps": outcome.wheel_steps,
        "ball_steps": outcome.ball_steps,
        "effective_wheel_steps": outcome.effective_wheel_steps,
        "effective_ball_steps": outcome.effective_ball_steps,
        "marker_before": outcome.marker_before.number,
        "marker_after": outcome.marker_after.number,
        "wheel_path": [p.number for p in outcome.wheel_path],
        "ball_path": [p.number for p in outcome.ball_path],
        "result": pocket_json(outcome.result),
        "settlements": [
            {
                "bet_id": s.bet.id,
                "player": s.bet.player,
                "type": s.bet.bet_type.value,
                "value": s.bet.value,
                "amount": s.bet.amount,
                "won": s.won,
                "delta": s.delta,
                "balance_after": s.balance_after,
            }
            for s in outcome.settlements
        ],
        "state": game_state_json(game),
    }
