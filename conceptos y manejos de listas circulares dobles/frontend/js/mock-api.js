// DEVELOPMENT-ONLY mock of the Python API, enabled with ?mock=1.
// It exists only so the UI can be checked without the backend. It returns
// contract-shaped data (docs/ARCHITECTURE.md section 5). The real app never loads
// this file: in production every list operation runs in Python.

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const N = ORDER.length;
const color = (n) => (n === 0 ? 'GREEN' : RED.has(n) ? 'RED' : 'BLACK');
const idx = (n) => ORDER.indexOf(n);
const at = (i) => ORDER[((i % N) + N) % N];
const pocket = (n) => ({ number: n, color: color(n) });
const neighbors = (n) => [-2, -1, 0, 1, 2].map((d) => at(idx(n) + d));

let g;
function fresh() {
  g = { round: 0, marker: 0, players: [], bets: [], nextBetId: 1, history: [], cursor: 0, capacity: 10 };
}
fresh();

const err = (message, status = 400) => ({ status, data: { error: message } });
const ok = (data) => ({ status: 200, data });

function covered(b) {
  switch (b.type) {
    case 'STRAIGHT': return [b.value];
    case 'NEIGHBORS': return neighbors(b.value);
    case 'COLOR': return ORDER.filter((n) => color(n) === b.value);
    case 'PARITY': return ORDER.filter((n) => n !== 0 && (n % 2 === 0) === (b.value === 'EVEN'));
    case 'DOZEN': return ORDER.filter((n) => n >= (b.value - 1) * 12 + 1 && n <= b.value * 12);
    default: return [];
  }
}
const PROFIT = { STRAIGHT: 35, COLOR: 1, PARITY: 1, DOZEN: 2, NEIGHBORS: 6 };

function state() {
  const h = g.history; // newest first
  const stats = { RED: 0, BLACK: 0, GREEN: 0 };
  h.forEach((n) => stats[color(n)]++);
  return {
    round: g.round,
    wheel: {
      size: N, head: 0, tail: at(-1), marker: g.marker,
      pockets: ORDER.map((n, i) => ({ number: n, color: color(n), previous: at(i - 1), next: at(i + 1) })),
    },
    players: g.players.map((p) => ({
      name: p.name, balance: p.balance,
      committed: g.bets.filter((b) => b.player === p.name).reduce((s, b) => s + b.amount, 0),
    })),
    pending_bets: g.bets.map((b) => ({ ...b, covered: covered(b) })),
    history: {
      capacity: g.capacity, size: h.length,
      results: h.map(pocket),
      cursor: h.length ? pocket(h[g.cursor]) : null,
      stats,
    },
  };
}

function spin(body) {
  const rnd = () => 37 + Math.floor(Math.random() * 149);
  const ws = body?.wheel_steps ?? rnd();
  const bs = body?.ball_steps ?? rnd();
  if (!Number.isInteger(ws) || !Number.isInteger(bs) || ws < 0 || bs < 0) return err('steps must be non-negative integers');
  const ew = ws % N, eb = bs % N;
  const before = g.marker;
  const wheelPath = [];
  for (let k = 1; k <= ew; k++) wheelPath.push(at(idx(before) + k));
  g.marker = at(idx(before) + ew);
  const ballPath = [];
  for (let k = 1; k <= eb; k++) ballPath.push(at(idx(g.marker) - k));
  const result = eb ? ballPath[ballPath.length - 1] : g.marker;
  g.round++;
  const settlements = g.bets.map((b) => {
    const won = covered(b).includes(result);
    const delta = won ? b.amount * PROFIT[b.type] : -b.amount;
    const p = g.players.find((x) => x.name === b.player);
    p.balance += delta;
    return { bet_id: b.id, player: b.player, type: b.type, value: b.value, amount: b.amount, won, delta, balance_after: p.balance };
  });
  g.bets = [];
  g.history.unshift(result);
  if (g.history.length > g.capacity) g.history.pop();
  g.cursor = 0;
  return ok({
    wheel_steps: ws, ball_steps: bs, effective_wheel_steps: ew, effective_ball_steps: eb,
    marker_before: before, marker_after: g.marker, wheel_path: wheelPath, ball_path: ballPath,
    result: pocket(result), settlements, state: state(),
  });
}

export function handle(method, fullPath, body) {
  const [path, query = ''] = fullPath.split('?');
  const params = new URLSearchParams(query);
  let m;
  if (method === 'GET' && path === '/state') return ok(state());
  if (method === 'GET' && path === '/wheel/order') {
    const dir = params.get('direction') ?? 'forward';
    if (!['forward', 'backward'].includes(dir)) return err('direction must be forward or backward');
    const step = dir === 'forward' ? 1 : -1;
    return ok({ direction: dir, start: g.marker, order: ORDER.map((_, k) => pocket(at(idx(g.marker) + step * k))) });
  }
  if (method === 'GET' && (m = path.match(/^\/pockets\/(-?\d+)$/))) {
    const n = Number(m[1]);
    if (n < 0 || n > 36) return err(`pocket ${n} does not exist`, 404);
    return ok({ number: n, color: color(n), previous: at(idx(n) - 1), next: at(idx(n) + 1), neighbors: neighbors(n) });
  }
  if (method === 'POST' && path === '/players') {
    const name = String(body?.name ?? '').trim();
    if (!name) return err('name must not be empty');
    if (!Number.isInteger(body?.balance) || body.balance <= 0) return err('balance must be a positive integer');
    if (g.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return err(`player ${name} already exists`);
    g.players.push({ name, balance: body.balance });
    return ok(state());
  }
  if (method === 'DELETE' && (m = path.match(/^\/players\/(.+)$/))) {
    const name = decodeURIComponent(m[1]);
    if (!g.players.some((p) => p.name === name)) return err(`unknown player ${name}`, 404);
    g.players = g.players.filter((p) => p.name !== name);
    g.bets = g.bets.filter((b) => b.player !== name);
    return ok(state());
  }
  if (method === 'POST' && path === '/bets') {
    const p = g.players.find((x) => x.name === body?.player);
    if (!p) return err(`unknown player ${body?.player}`);
    if (!Number.isInteger(body.amount) || body.amount <= 0) return err('amount must be a positive integer');
    const committed = g.bets.filter((b) => b.player === p.name).reduce((s, b) => s + b.amount, 0);
    if (p.balance < committed + body.amount) return err(`${p.name} cannot cover ${body.amount} (balance ${p.balance}, committed ${committed})`);
    const b = { id: g.nextBetId++, player: p.name, type: body.type, value: body.value, amount: body.amount };
    g.bets.push(b);
    return ok(state());
  }
  if (method === 'DELETE' && (m = path.match(/^\/bets\/(\d+)$/))) {
    const id = Number(m[1]);
    if (!g.bets.some((b) => b.id === id)) return err(`unknown bet ${id}`, 404);
    g.bets = g.bets.filter((b) => b.id !== id);
    return ok(state());
  }
  if (method === 'POST' && path === '/spin') return spin(body);
  if (method === 'POST' && path === '/history/cursor') {
    if (!g.history.length) return err('history is empty');
    const d = body?.direction;
    if (d !== 'older' && d !== 'newer') return err('direction must be older or newer');
    const s = g.history.length;
    g.cursor = (g.cursor + (d === 'older' ? 1 : -1) + s) % s;
    return ok(state());
  }
  if (method === 'POST' && path === '/reset') {
    fresh();
    if (body?.demo) g.players.push({ name: 'Ana', balance: 100 }, { name: 'Luis', balance: 100 });
    return ok(state());
  }
  return err(`unknown route ${method} ${path}`, 404);
}
