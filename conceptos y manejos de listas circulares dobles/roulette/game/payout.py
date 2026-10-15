"""Bet evaluation rules (net profit multipliers).

A winning bet pays ``amount * multiplier`` as net profit; a losing bet costs
``amount``. Multipliers: STRAIGHT 35x, COLOR/PARITY 1x, DOZEN 2x, NEIGHBORS 6x.
"""

from __future__ import annotations

from roulette.game.wheel import Wheel
from roulette.models.bet import Bet, BetType
from roulette.models.color import Color
from roulette.models.pocket import Pocket

#: Net profit multipliers per bet type.
PAYOUT_MULTIPLIERS: dict[BetType, int] = {
    BetType.STRAIGHT: 35,
    BetType.COLOR: 1,
    BetType.PARITY: 1,
    BetType.DOZEN: 2,
    BetType.NEIGHBORS: 6,
}


def bet_wins(bet: Bet, result: Pocket, wheel: Wheel) -> bool:
    """Return ``True`` when ``bet`` wins on the given spin ``result``.

    Note: 0 (green) makes COLOR, PARITY and DOZEN bets always lose.
    """
    n = result.number
    if bet.bet_type is BetType.STRAIGHT:
        return n == bet.value
    if bet.bet_type is BetType.COLOR:
        return result.color is Color[bet.value]  # green 0 never matches
    if bet.bet_type is BetType.PARITY:
        if n == 0:
            return False
        return (n % 2 == 0) == (bet.value == "EVEN")
    if bet.bet_type is BetType.DOZEN:
        if n == 0:
            return False
        return (n - 1) // 12 + 1 == bet.value
    # NEIGHBORS: physical proximity on the wheel, not on the betting table.
    return n in {p.number for p in wheel.neighbors(int(bet.value))}


def settle(bet: Bet, result: Pocket, wheel: Wheel) -> tuple[bool, int]:
    """Evaluate ``bet`` against ``result``.

    Returns ``(won, delta)`` where ``delta`` is the signed balance change:
    ``+amount * multiplier`` on a win, ``-amount`` on a loss.
    """
    won = bet_wins(bet, result, wheel)
    delta = bet.amount * PAYOUT_MULTIPLIERS[bet.bet_type] if won else -bet.amount
    return won, delta
