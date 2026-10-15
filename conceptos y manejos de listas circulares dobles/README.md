# European Roulette on a Circular Doubly Linked List

A European roulette simulator for a university data-structures workshop. The core of the
project is a generic, reusable **circular doubly linked list** written in Python with no
external dependencies: the wheel's 37 pockets, the fixed-capacity spin history and every
spin, neighbor and payout calculation are implemented as pointer operations on that list.
A built-in HTTP server exposes the game as a JSON API and serves a plain HTML/CSS/JS
frontend that renders a rotating wheel, a betting table with chips, and a live
visualization of the linked list as the marker and the ball traverse it.

## 1. The case study

The project is framed as a **casino training simulator**: an application where trainees
practice croupier and betting-table procedures without real money. The exercise asks which
data structure models the physical device naturally, and the answer is the circular
doubly linked list.

| Problem feature | Structure requirement |
|---|---|
| The wheel has no "last" pocket — after 26 it wraps back to 0 | A ring with no `None` pointers: `tail.next` is `head`, so there is no end sentinel to special-case |
| The wheel spins **forward** while the ball rolls **backward** around it | Two link directions per node: `next` (clockwise) and `previous` (counter-clockwise), both traversable in O(1) per hop |
| The *neighbors* bet is defined by physical adjacency: two pockets on each side of a number | Cheap bidirectional traversal from any node: read `previous` twice and `next` twice with no search from the head |
| A spin can be thousands of steps (many full laps) | `steps % n` reduces any step count to at most one lap; the modulo trick is only correct because traversal wraps |
| Recent results must be remembered in a small, fixed window | A fixed-capacity ring: overwrite the oldest node in place instead of growing the structure |

## 2. Circular doubly linked list concepts

### 2.1 Node anatomy

A node stores a value and two pointers. A freshly created node points to **itself** in
both directions, which already makes it a valid one-element circular list:

```python
class Node(Generic[T]):
    __slots__ = ("value", "next", "previous")

    def __init__(self, value: T) -> None:
        self.value: T = value
        self.next: Node[T] = self
        self.previous: Node[T] = self
```

### 2.2 The ring

The list keeps a `head` pointer and a `size` counter; `tail` is a property (`head.previous`).
No pointer in the structure is ever `None` (unless the list is empty):

```
          tail                 head
           |                    |
           v                    v
     +----------+   next   +----------+   next   +----------+
 ... |    26    | -------> |    0     | -------> |    32    | ...
     |          | <------- |          | <------- |          |
     +----------+ previous +----------+ previous +----------+
           ^                                           |
           |        next / previous links continue     |
           +--------- 15, 19, 4, ... , 35, 3 <---------+

     head.previous is tail (26)        tail.next is head (0)
```

Reading the diagram: following `next` walks clockwise (0 -> 32 -> 15 -> ...); following
`previous` walks counter-clockwise (0 -> 26 -> 3 -> ...).

### 2.3 Invariants

- `head.previous is tail` and `tail.next is head` — the ring is closed.
- For every node `a`: `a.next.previous is a` and `a.previous.next is a` — links are
  symmetric. `check_integrity()` verifies this with one lap.
- `size` equals the number of nodes visited in exactly one lap.
- When the list has one node, that node points to itself in both directions.

### 2.4 Operations and complexity

| Method | Description | Complexity |
|---|---|---|
| `append(value)` | insert before head (becomes tail) | O(1) |
| `prepend(value)` | insert before head and move head to it | O(1) |
| `insert_after(node, value)` | insert right after a given node | O(1) |
| `remove_node(node)` | unlink a node; fixes head; empties list if last | O(1) |
| `remove(value)` | remove first node whose value == value (`ValueError` if missing) | O(n) |
| `find(predicate)` | first node matching predicate, clockwise from head | O(n) |
| `step(node, steps, direction)` | move `steps` positions via `next`/`previous`, using `steps % size` | O(steps % n) |
| `walk(node, steps, direction)` | like `step` but returns every visited node (excluding start) | O(steps % n) |
| `traverse(start, direction)` / `nodes(...)` | one full lap with do/while semantics | O(n) |
| `check_integrity()` | assert link symmetry and size | O(n) |

All insertions and removals are O(1) because no element is ever shifted: four pointer
assignments splice a node in, four more splice it out.

### 2.5 Real code: `append`, `remove_node`, `step`

Splicing a node in (`roulette/data_structures/circular_doubly_linked_list.py`):

```python
def append(self, value: T) -> Node[T]:
    new_node: Node[T] = Node(value)
    if self.head is None:
        # First node: it points to itself in both directions.
        self.head = new_node
    else:
        tail = self.head.previous
        # Stitch tail -> new_node -> head.
        new_node.previous = tail
        new_node.next = self.head
        tail.next = new_node
        self.head.previous = new_node
    self.size += 1
    return new_node
```

Splicing a node out:

```python
def remove_node(self, node: Node[T]) -> T:
    self._require_head()
    value = node.value
    if node.next is node:
        # Single node list: removing it empties the list.
        self.head = None
    else:
        prev = node.previous
        nxt = node.next
        prev.next = nxt
        nxt.previous = prev
        if node is self.head:
            self.head = nxt
    self.size -= 1
    # Defensive cleanup so a detached node cannot corrupt the list later.
    node.next = node
    node.previous = node
    return value
```

Moving around the ring:

```python
def step(self, node: Node[T], steps: int, direction: Direction = Direction.FORWARD) -> Node[T]:
    if steps < 0:
        raise ValueError("steps must be >= 0")
    self._require_head()
    hops = steps % self.size
    current = node
    for _ in range(hops):
        current = current.next if direction is Direction.FORWARD else current.previous
    return current
```

### 2.6 Why traversal uses do/while semantics

There is no node whose pointer is `None`, so the classic `while node is not None` loop
never terminates: every hop lands on a real node and the walk circles forever. The
termination condition is **identity with the start node**, and the start node must be
visited *before* the check, otherwise a one-node list (where start is already reached)
would yield nothing. Every lap is therefore a do/while loop:

```python
while True:  # do/while: always inspect the start node at least once
    if predicate(node.value):
        return node
    node = node.next
    if node is start:
        break
```

### 2.7 Edge cases

- **Empty list**: `head` is `None`; mutating operations raise `IndexError`, `find`
  returns `None`, iteration yields nothing.
- **Single node**: the node's `next` and `previous` both point to itself; removing it
  sets `head = None` instead of unlinking.
- **Removing the head** of a longer list: the neighbors are stitched together and the
  head moves to `node.next`, keeping the ring closed.
- **Negative steps** raise `ValueError`; the modulo reduction keeps every hop count in
  `0 .. n-1`.

## 3. Domain model

### 3.1 Wheel

The 37 pockets live **only** in a `CircularDoublyLinkedList[Pocket]`; the physical order
is encoded in the links, never in a Python list (Python lists appear only as return
values for the UI). Clockwise order starting at head = 0:

```
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
```

Red: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36. Green: 0. All
others black.

- **`marker`**: the node currently under the fixed table marker. Starts at head (0).
- **`spin_wheel(steps)`**: the marker advances `steps % 37` clockwise (`next`); returns
  the visited pockets as the animation path.
- **`launch_ball(steps)`**: starting *from the marker*, the ball walks `steps % 37`
  counter-clockwise (`previous`); the landing pocket is the spin result. The marker does
  not move — the ball is the only thing traveling backwards.
- **`neighbors(number, radius=2)`** returns `[prev2, prev1, n, next1, next2]`. Because
  the list is circular, proximity crosses the head/tail seam naturally: the neighbors of
  0 are `[3, 26, 0, 32, 15]` — 26 is the tail (`previous` of head 0) and 32 is the first
  node after the head (`next` of 0).

### 3.2 SpinHistory: a ring that never allocates

The history is its own `CircularDoublyLinkedList[Pocket]` with a fixed capacity (default
10) and a `latest` node. While it is not full, `record` appends. Once full, it
**overwrites the oldest node in place** — the oldest is always `latest.next` — and moves
`latest` onto it:

```python
if self._ring.size < self.capacity:
    self.latest = self._ring.append(pocket)
else:
    oldest = self.latest.next  # oldest is always right after latest
    oldest.value = pocket      # overwrite instead of unlink/append
    self.latest = oldest
```

No node is ever unlinked or allocated after warm-up: the ring reaches `capacity` nodes
and stays there. The UI cursor (`move_cursor("older")` / `move_cursor("newer")`) walks
`previous`/`next` around the ring and wraps around — that is the point of a ring.

### 3.3 Bets and payouts (net profit multipliers)

| `BetType` | `value` | Wins when | Net profit |
|---|---|---|---|
| `STRAIGHT` | int 0..36 | result == value | 35 x amount |
| `COLOR` | `"RED"` / `"BLACK"` | color matches (0 always loses) | 1 x amount |
| `PARITY` | `"EVEN"` / `"ODD"` | parity matches (0 always loses) | 1 x amount |
| `DOZEN` | 1 / 2 / 3 | 1-12 / 13-24 / 25-36 (0 always loses) | 2 x amount |
| `NEIGHBORS` | int 0..36 | result is in `wheel.neighbors(value)` | 6 x amount |

A losing bet subtracts `amount` from the balance. The balance is **not** debited at
placement; placement only requires `balance >= amount + sum(pending bets)`. Every bet
gets an incremental `id`, and `Bet.covered_numbers(wheel)` tells the UI which pockets to
highlight.

## 4. Project structure

```
conceptos y manejos de listas circulares dobles/
├── README.md
├── run.py                              # python run.py -> starts server and opens browser
├── docs/
│   └── ARCHITECTURE.md                 # single source of truth for all contributors
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

## 5. How to run

Requirements: **Python 3.13**, no external dependencies (standard library only).

```bash
# start the server and open the UI in the browser
python run.py                     # http://127.0.0.1:8000

# options
python run.py --port 9000         # serve on another port
python run.py --no-browser       # do not auto-open the browser

# run the test suite from the project folder
python -m unittest discover -s tests -v
```

## 6. HTTP API summary

All responses are JSON (`Content-Type: application/json; charset=utf-8`). Errors return
status 400 (404 for an unknown route or pocket) with `{"error": "<message>"}`. `GET /`
serves the frontend; other non-`/api` paths serve static files from `frontend/`.

| Method & path | Body | Response |
|---|---|---|
| `GET /api/state` | — | `GameState` |
| `GET /api/wheel/order?direction=forward\|backward` | — | `{"direction", "start" (marker), "order": [Pocket...]}` |
| `GET /api/pockets/<n>` | — | `{"number", "color", "previous", "next", "neighbors": [5 numbers]}` |
| `POST /api/players` | `{"name", "balance"}` | `GameState` |
| `DELETE /api/players/<name>` | — | `GameState` |
| `POST /api/bets` | `{"player", "type", "value", "amount"}` | `GameState` |
| `DELETE /api/bets/<id>` | — | `GameState` |
| `POST /api/spin` | `{"wheel_steps", "ball_steps"}` (both optional) | `SpinOutcome` |
| `POST /api/history/cursor` | `{"direction": "older" \| "newer"}` | `GameState` |
| `POST /api/reset` | `{"demo": true}` optional | `GameState` (demo seeds Ana and Luis with 100 each) |

## 7. Reference scenario (worked example)

Start: marker at 0, players Ana and Luis with 100 each.

| Spin | Bets | wheel_steps | ball_steps | marker_after | Result | Balances after |
|---|---|---|---|---|---|---|
| 1 | Ana STRAIGHT 15 ($10), Luis COLOR RED ($20) | 5 | 3 | 21 | 15 BLACK | Ana 450, Luis 80 |
| 2 | Ana NEIGHBORS 6 ($10), Luis PARITY EVEN ($20) | 10 | 6 | 30 | 34 RED | Ana 510, Luis 100 |
| 3 | Ana DOZEN 1 ($10), Luis COLOR RED ($50) | 40 | 38 | 10 | 23 RED | Ana 500, Luis 150 |

History newest first after spin 3: `23, 34, 15`.

### Pointer walk for spin 1

`wheel_steps = 5`, so the marker walks 5 nodes clockwise (`next`) from 0:

| Hop | Operation | Node reached | Pocket |
|---|---|---|---|
| 1 | `marker = marker.next` | node of 32 | 32 |
| 2 | `marker = marker.next` | node of 15 | 15 |
| 3 | `marker = marker.next` | node of 19 | 19 |
| 4 | `marker = marker.next` | node of 4 | 4 |
| 5 | `marker = marker.next` | node of 21 | 21 |

`wheel_path = [32, 15, 19, 4, 21]`, marker_after = 21.

Then `ball_steps = 3`: the ball walks 3 nodes counter-clockwise (`previous`) *from the new
marker* (21), without moving it:

| Hop | Operation | Node reached | Pocket |
|---|---|---|---|
| 1 | `current = current.previous` | node of 4 | 4 |
| 2 | `current = current.previous` | node of 19 | 19 |
| 3 | `current = current.previous` | node of 15 | 15 |

`ball_path = [4, 19, 15]`, result = **15 BLACK**. Settlement: Ana's STRAIGHT 15 wins
`10 * 35 = 350` (balance 450); Luis's COLOR RED loses 20 (balance 80).

## 8. Analysis questions

**What is the complexity of spinning the wheel?**
With the modulo reduction (`steps % 37`), `spin_wheel`/`launch_ball` walk at most one lap
regardless of how large the step count is: O(n) with n = 37, i.e. O(1) for a fixed-size
wheel. Without the modulo, a spin of `s` steps would cost O(s) pointer hops — for random
spins (37 to 185 steps) that is up to 5 full laps of wasted work per spin.

**Could `neighbors` be implemented with a singly linked list?**
No, not without losing O(1) reads on both sides. A singly linked list only has `next`, so
reaching the two pockets *before* the center requires a full clockwise lap from the head
to find the node whose `next` is the center (or walking almost the whole ring backwards
the long way around). The doubly linked list reads `previous` twice and `next` twice from
the center node directly: five nodes in at most 4 hops, no searching.

**Why is the history a ring and not an array with an index?**
Both can keep the last N results, but the ring demonstrates the structure the workshop
studies and it reuses nodes: once full, `record` overwrites the oldest node's `value` in
place and rotates `latest` — no allocation, no unlinking, no shifting of elements, and no
index arithmetic (`(i + 1) % capacity`) to keep in sync. Bidirectional cursor navigation
(`older` = `previous`, `newer` = `next`) comes for free from the links and wraps around
naturally.

**What breaks if `head.previous` were `None`?**
The ring opens at the seam. `append` would insert at the tail without connecting back to
the head, so `tail.next is head` would be false and a clockwise lap would stop (or fall
into `None`) before reaching the head; `launch_ball` could not walk backwards across the
0/26 seam; `neighbors(0)` could not produce `[3, 26, 0, 32, 15]`; and `check_integrity`
would raise on the first broken `a.next.previous is not a` pair. Every invariant of the
structure depends on the circle being closed in both directions.
