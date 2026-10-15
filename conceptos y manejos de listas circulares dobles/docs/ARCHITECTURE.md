# Architecture & API Contract — European Roulette on a Circular Doubly Linked List

This document is the single source of truth for every contributor (backend and frontend).
All code, identifiers, comments, docstrings and docs are written in **English**.

## 1. Golden rule

**Every circular doubly linked list operation lives in Python.** The frontend never
re-implements list logic: it does not compute the wheel order, neighbors, spin results,
payouts or history. It only renders what the Python API returns and animates it.

## 2. Tech stack

- Python 3.13, **standard library only** (no pip dependencies): `dataclasses`, `enum`,
  `typing`, `http.server` (`ThreadingHTTPServer`), `json`, `random`, `threading`, `unittest`.
- Frontend: plain HTML + CSS + vanilla JavaScript (ES modules), SVG for the wheel.
  No build step, no npm. Served as static files by the Python server.

## 3. Folder layout

```
conceptos y manejos de listas circulares dobles/
├── README.md
├── run.py                              # python run.py -> starts server and opens browser
├── docs/
│   └── ARCHITECTURE.md                 # this file
├── roulette/
│   ├── __init__.py
│   ├── data_structures/
│   │   ├── __init__.py
│   │   ├── node.py                     # Node[T]
│   │   └── circular_doubly_linked_list.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── color.py                    # Color enum: RED, BLACK, GREEN
│   │   ├── pocket.py                   # Pocket(number, color) frozen dataclass
│   │   ├── player.py                   # Player(name, balance)
│   │   └── bet.py                      # BetType enum + Bet dataclass
│   ├── game/
│   │   ├── __init__.py
│   │   ├── wheel.py                    # Wheel built on CircularDoublyLinkedList[Pocket]
│   │   ├── spin_history.py             # fixed-capacity ring on CircularDoublyLinkedList
│   │   ├── payout.py                   # bet evaluation rules
│   │   └── roulette_game.py            # facade: players, bets, spins, settlement
│   └── api/
│       ├── __init__.py
│       ├── serializers.py              # domain objects -> JSON-ready dicts
│       └── server.py                   # JSON API + static file serving
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/ (api.js, wheel.js, list-view.js, app.js, ...)
└── tests/
    ├── __init__.py
    ├── test_circular_doubly_linked_list.py
    ├── test_wheel.py
    ├── test_spin_history.py
    ├── test_payout.py
    ├── test_roulette_game.py           # includes the reference scenario (section 7)
    └── test_api.py                     # starts server on a free port, hits endpoints
```

Run tests from the project folder: `python -m unittest discover -s tests -v`.

## 4. Domain

### 4.1 `Node[T]`
Fields: `value: T`, `next: Node[T]`, `previous: Node[T]`. A freshly created node points to
itself in both directions.

### 4.2 `CircularDoublyLinkedList[T]` (generic, reusable)
Attributes: `head`, `size`. `tail` is a property (`head.previous`). Public API:

| Method | Description | Complexity |
|---|---|---|
| `append(value) -> Node` | insert before head (becomes tail) | O(1) |
| `prepend(value) -> Node` | insert before head and move head to it | O(1) |
| `insert_after(node, value) -> Node` | insert right after a given node | O(1) |
| `remove_node(node) -> T` | unlink a node; fixes head; empties list if last | O(1) |
| `remove(value) -> T` | remove first node whose value == value, `ValueError` if missing | O(n) |
| `find(predicate) -> Node \| None` | first node matching predicate, clockwise from head | O(n) |
| `step(node, steps, direction) -> Node` | move `steps` positions using `next` (`Direction.FORWARD`) or `previous` (`Direction.BACKWARD`); uses `steps % size` | O(steps % n) |
| `walk(node, steps, direction) -> list[Node]` | same as `step` but returns every visited node (excluding start) | O(steps % n) |
| `traverse(start=None, direction=FORWARD) -> Iterator[T]` | one full lap with `do/while` semantics | O(n) |
| `nodes(start=None, direction=FORWARD) -> Iterator[Node]` | same, yielding nodes | O(n) |
| `is_empty()`, `__len__`, `__iter__`, `__contains__`, `__repr__`, `clear()` | | |
| `check_integrity() -> None` | raises `AssertionError` if any `a.next.previous is not a` or size mismatch | O(n) |

`Direction` is an `Enum` (`FORWARD`, `BACKWARD`) in `circular_doubly_linked_list.py`.
Negative steps raise `ValueError`. Operations on an empty list raise `IndexError` with a
clear message (except `find`, which returns `None`, and iteration, which yields nothing).

### 4.3 Wheel
European order (clockwise, `next` direction), head = 0:

```
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
```

Red: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36. Green: 0. Rest black.

- `marker`: node currently under the fixed table marker. Starts at head (0).
- `spin_wheel(steps) -> list[Pocket]`: marker advances `steps % 37` with `next`; returns
  visited pockets (path).
- `launch_ball(steps) -> tuple[Pocket, list[Pocket]]`: starting from the marker, walk
  `steps % 37` with `previous`; the landing pocket is the result. Marker does not move.
- `pocket(number) -> Pocket`, `node_of(number) -> Node[Pocket]` (`ValueError` if not 0..36).
- `neighbors(number, radius=2) -> list[Pocket]`: `[prev2, prev1, n, next1, next2]`.
  Neighbors of 0 are `[3, 26, 0, 32, 15]` (crosses the head/tail seam).
- `order(direction, start=None) -> list[Pocket]`: full lap from start (default marker).

### 4.4 SpinHistory (capacity 10, configurable)
Backed by its own `CircularDoublyLinkedList[Pocket]`. Keeps `latest` node.
- `record(pocket)`: if not full, append; if full, overwrite the oldest (`latest.next`) and
  move `latest` to it. **Never** allocates once full.
- `newest_first() -> list[Pocket]` (walk `previous` from latest), `oldest_first()`.
- Cursor navigation for the UI: `cursor` node; `move_cursor(direction)` where `"older"`
  uses `previous` and `"newer"` uses `next`; it wraps around (that is the point of a ring).
  `record` resets the cursor to `latest`.
- `stats() -> dict` with counts `{"RED": n, "BLACK": n, "GREEN": n}`.
- Empty history: `newest_first()` returns `[]`, `move_cursor` raises `IndexError`.

### 4.5 Bets & payouts (net profit multipliers)

| `BetType` | `value` | Wins when | Profit |
|---|---|---|---|
| `STRAIGHT` | int 0..36 | result == value | 35 × amount |
| `COLOR` | `"RED"` / `"BLACK"` | color matches (0 always loses) | 1 × amount |
| `PARITY` | `"EVEN"` / `"ODD"` | parity matches (0 always loses) | 1 × amount |
| `DOZEN` | 1 / 2 / 3 | 1-12 / 13-24 / 25-36 (0 always loses) | 2 × amount |
| `NEIGHBORS` | int 0..36 | result is in `wheel.neighbors(value)` | 6 × amount |

A losing bet subtracts `amount` from the balance. Balance is **not** debited at placement;
instead placement requires `balance >= amount + sum(player's pending bets)`.
`amount` must be a positive int. Every bet gets an incremental `id`.
`Bet.covered_numbers(wheel) -> list[int]` returns the numbers the bet covers (used by the UI
to highlight pockets).

### 4.6 RouletteGame (facade, used by the API)
Holds `wheel`, `history`, `players` (dict by name, insertion order), `pending_bets`,
`round_number`. Methods: `add_player(name, balance)`, `remove_player(name)` (also drops
their pending bets), `place_bet(player, bet_type, value, amount)`, `cancel_bet(bet_id)`,
`spin(wheel_steps=None, ball_steps=None, rng=None) -> SpinOutcome`, `reset()`.
Random steps when omitted: `rng.randint(37, 185)` for each.
Duplicate player names (case-insensitive) raise `ValueError`. Invalid input -> `ValueError`.

## 5. HTTP API (JSON, `http://127.0.0.1:8000`)

All errors: status 400 (or 404 for unknown route/pocket) with `{"error": "<message>"}`.
Request bodies are JSON. Responses use `Content-Type: application/json; charset=utf-8`.
`GET /` serves `frontend/index.html`; other non-`/api` paths serve files from `frontend/`
(guard against path traversal).

### `GameState` object (returned by most endpoints)
```json
{
  "round": 3,
  "wheel": {
    "size": 37,
    "head": 0,
    "tail": 26,
    "marker": 10,
    "pockets": [{"number": 0, "color": "GREEN", "previous": 26, "next": 32}, ...]
  },
  "players": [{"name": "Ana", "balance": 500, "committed": 0}],
  "pending_bets": [
    {"id": 7, "player": "Ana", "type": "NEIGHBORS", "value": 6, "amount": 10,
     "covered": [17, 34, 6, 27, 13]}
  ],
  "history": {
    "capacity": 10,
    "size": 3,
    "results": [{"number": 23, "color": "RED"}, {"number": 34, "color": "RED"}, {"number": 15, "color": "BLACK"}],
    "cursor": {"number": 23, "color": "RED"},
    "stats": {"RED": 2, "BLACK": 1, "GREEN": 0}
  }
}
```
`wheel.pockets` is always in list order starting at head (clockwise). `history.results` is
newest first. `cursor` is `null` when the history is empty.

### Endpoints
| Method & path | Body | Response |
|---|---|---|
| `GET /api/state` | — | `GameState` |
| `GET /api/wheel/order?direction=forward\|backward` | — | `{"direction": "...", "start": <marker>, "order": [Pocket...]}` |
| `GET /api/pockets/<n>` | — | `{"number", "color", "previous", "next", "neighbors": [5 numbers]}` |
| `POST /api/players` | `{"name": "Ana", "balance": 100}` | `GameState` |
| `DELETE /api/players/<name>` | — | `GameState` |
| `POST /api/bets` | `{"player": "Ana", "type": "STRAIGHT", "value": 15, "amount": 10}` | `GameState` |
| `DELETE /api/bets/<id>` | — | `GameState` |
| `POST /api/spin` | `{"wheel_steps": 40, "ball_steps": 38}` (both optional) | `SpinOutcome` |
| `POST /api/history/cursor` | `{"direction": "older" \| "newer"}` | `GameState` |
| `POST /api/reset` | `{"demo": true}` optional | `GameState` (demo seeds Ana and Luis with 100 each) |

### `SpinOutcome`
```json
{
  "wheel_steps": 40, "ball_steps": 38,
  "effective_wheel_steps": 3, "effective_ball_steps": 1,
  "marker_before": 30, "marker_after": 10,
  "wheel_path": [8, 23, 10],
  "ball_path": [23],
  "result": {"number": 23, "color": "RED"},
  "settlements": [
    {"bet_id": 5, "player": "Luis", "type": "COLOR", "value": "RED", "amount": 50,
     "won": true, "delta": 50, "balance_after": 150}
  ],
  "state": { GameState }
}
```

## 6. Frontend animation semantics

- Pockets are drawn clockwise in `wheel.pockets` order.
- After a spin, the wheel must end rotated so that `marker_after` sits under the fixed
  marker at the top. Visually the wheel turns **clockwise** (add cosmetic full laps).
- The ball travels **counter-clockwise** (cosmetic laps allowed) and must finish on
  `result.number`, which is `effective_ball_steps` pockets to the left of the marker.
- The list visualization replays `wheel_path` (next links) and then `ball_path`
  (previous links) node by node.

## 7. Reference scenario (must pass as a test)

Start: marker at 0, players Ana and Luis with 100 each.

| Spin | Bets | wheel_steps | ball_steps | marker_after | Result | Balances after |
|---|---|---|---|---|---|---|
| 1 | Ana STRAIGHT 15 ($10), Luis COLOR RED ($20) | 5 | 3 | 21 | 15 BLACK | Ana 450, Luis 80 |
| 2 | Ana NEIGHBORS 6 ($10), Luis PARITY EVEN ($20) | 10 | 6 | 30 | 34 RED | Ana 510, Luis 100 |
| 3 | Ana DOZEN 1 ($10), Luis COLOR RED ($50) | 40 | 38 | 10 | 23 RED | Ana 500, Luis 150 |

History newest first after spin 3: `23, 34, 15`. Paths: spin 1 `wheel_path = [32, 15, 19, 4, 21]`,
`ball_path = [4, 19, 15]`; spin 3 `wheel_path = [8, 23, 10]`, `ball_path = [23]`.
