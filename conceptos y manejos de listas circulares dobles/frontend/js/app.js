// App controller: wires DOM events to the API and hands responses to the views.
// Golden rule: no list logic here. Order, neighbors, results, paths, payouts,
// history and stats all come from the Python API.

import { api, USE_MOCK } from './api.js';
import { Wheel } from './wheel.js';
import { ListView } from './list-view.js';
import { HistoryView } from './history-view.js';
import { BettingTable } from './betting-table.js';
import {
  renderPlayers, renderPlayerSelect, renderBets, renderValueInput, readBetValue,
  setNumberValue, renderResult, renderSettlements, betLabel,
} from './table.js';
import { h, toast, colorName, signed, money } from './util.js';

const $ = (id) => document.getElementById(id);

const app = {
  state: null,
  spinning: false,
  lastOutcome: null,
  listToken: null,
  focusedBet: null,
  inspected: null,
  playerColors: new Map(),
};

// ---------- views ----------
const wheel = new Wheel($('wheel-host'), {
  onPocketClick: (n, e) => {
    if (e?.shiftKey || e?.altKey) placeFromTable('NEIGHBORS', n, felt.chip);
    else inspect(n);
  },
});
const felt = new BettingTable($('felt-host'), {
  onPlace: (type, value, amount) => placeFromTable(type, value, amount),
  onRemove: (id) => cancelBet(id),
  onFocusBet: (b) => { app.focusedBet = b; refreshCovered(); },
  onChipChange: (v) => { $('bet-amount').value = v; },
});
const list = new ListView($('list-host'), {
  onNodeClick: (n) => inspect(n),
  captionEl: $('list-caption'),
  trailEl: $('list-trail'),
  codeEl: $('list-code'),
});
const historyView = new HistoryView($('history-host'), $('history-cursor'), $('stats'));

// ---------- helpers ----------
function colorOf(n) {
  return app.state?.wheel.pockets.find((p) => p.number === n)?.color;
}

function showError(el, err) {
  const msg = err?.message ?? String(err);
  if (el) { el.textContent = msg; el.hidden = false; }
  toast(msg, 'error');
}

function clearError(el) { if (el) { el.hidden = true; el.textContent = ''; } }

function setBusy(busy) {
  app.spinning = busy;
  document.body.classList.toggle('is-spinning', busy);
  document.querySelectorAll('[data-mutates]').forEach((b) => { b.disabled = busy; });
  $('btn-fwd').disabled = busy;
  $('btn-bwd').disabled = busy;
  $('btn-spin').setAttribute('aria-busy', String(busy));
}

function refreshCovered() {
  const bets = app.state?.pending_bets ?? [];
  const numbers = app.focusedBet ? app.focusedBet.covered : bets.flatMap((b) => b.covered);
  wheel.setCovered(numbers);
  felt.setFocus(app.focusedBet ? app.focusedBet.covered : []);
  $('wheel-host').classList.toggle('focus-bet', Boolean(app.focusedBet));
}

function newListToken() {
  if (app.listToken) app.listToken.cancelled = true;
  app.listToken = { cancelled: false };
  $('btn-skip').disabled = false;
  return app.listToken;
}

function listDone(token) {
  if (app.listToken === token) {
    $('btn-skip').disabled = true;
    app.listToken = null;
    if (app.state) list.render(app.state.wheel);
  }
}

// ---------- state rendering ----------
function renderWheelCaption(w) {
  $('wheel-caption').replaceChildren('Marker on ', h('strong', { text: w.marker }),
    h('span', { class: 'muted', text: ` · head ${w.head} · tail ${w.tail} · size ${w.size}` }));
}

function applyState(state) {
  app.state = state;
  $('round-pill').textContent = `Round ${state.round}`;
  wheel.render(state.wheel);
  list.render(state.wheel);
  historyView.render(state.history);
  renderWheelCaption(state.wheel);

  app.playerColors = new Map(state.players.map((p, i) => [p.name, PLAYER_COLORS[i % PLAYER_COLORS.length]]));
  renderPlayerSelect($('bet-player'), state.players);
  renderPlayersPanel();
  felt.render(state, { playerColors: app.playerColors, disabled: app.spinning });
  if (app.focusedBet && !state.pending_bets.some((b) => b.id === app.focusedBet.id)) app.focusedBet = null;
  renderBets($('bet-list'), $('bet-count'), state.pending_bets, colorOf, {
    onCancel: cancelBet,
    onFocusBet: (b) => { app.focusedBet = b; refreshCovered(); },
  });
  refreshCovered();
  if (!app.lastOutcome) renderResult($('result-badge'), state.history.results[0] ?? null, null);
  if (app.spinning) setBusy(true);
}

async function mutate(call, errEl) {
  if (app.spinning) return null;
  try {
    const state = await call();
    clearError(errEl);
    applyState(state);
    return state;
  } catch (err) {
    showError(errEl, err);
    return null;
  }
}

// ---------- players ----------
// Cosmetic colours to tell players' chips apart (assigned by position in the API list).
const PLAYER_COLORS = ['#f3d36b', '#6ee7dc', '#f9a8d4', '#a5b4fc', '#fdba74', '#86efac', '#fca5a5', '#e9d5ff'];

function renderPlayersPanel() {
  const players = app.state?.players ?? [];
  const selected = $('bet-player').value;
  renderPlayers($('player-list'), players, { onRemove: removePlayer, onSelect: selectPlayer, selected, colors: app.playerColors });
  felt.setPlayer(selected || null, app.playerColors.get(selected));
  if (app.spinning) setBusy(true);
}

function selectPlayer(name) {
  $('bet-player').value = name;
  renderPlayersPanel();
}
$('bet-player').addEventListener('change', renderPlayersPanel);

async function placeFromTable(type, value, amount) {
  const player = $('bet-player').value;
  const err = $('felt-error');
  if (!player) return showError(err, new Error('Add a player before placing chips.'));
  const ok = await mutate(() => api.placeBet(player, type, value, amount), err);
  if (ok) toast(`${player}: ${betLabel(type, value)} +${money(amount)}`, 'success', 2200);
}
$('player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('player-name').value.trim();
  const balanceRaw = $('player-balance').value.trim();
  const err = $('player-error');
  if (!name) return showError(err, new Error('Enter a player name.'));
  if (!/^\d+$/.test(balanceRaw)) return showError(err, new Error('Balance must be a positive whole number.'));
  const ok = await mutate(() => api.addPlayer(name, Number(balanceRaw)), err);
  if (ok) {
    toast(`${name} joined the table with ${money(Number(balanceRaw))}.`, 'success');
    $('player-name').value = '';
    $('player-name').focus();
  }
});

async function removePlayer(name) {
  const ok = await mutate(() => api.removePlayer(name), $('player-error'));
  if (ok) toast(`${name} left the table. Their pending bets were dropped.`);
}

// ---------- bets ----------
const betType = () => document.querySelector('input[name="bet-type"]:checked').value;
$('bet-type-group').addEventListener('change', () => renderValueInput($('bet-value-wrap'), betType()));
renderValueInput($('bet-value-wrap'), betType());

document.querySelectorAll('.chip-btn[data-amount]').forEach((b) => b.addEventListener('click', () => {
  $('bet-amount').value = b.dataset.amount;
}));

$('bet-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('bet-error');
  const player = $('bet-player').value;
  if (!player) return showError(err, new Error('Add a player before placing bets.'));
  const type = betType();
  const v = readBetValue($('bet-value-wrap'), type);
  if (v.error) return showError(err, new Error(v.error));
  const amountRaw = $('bet-amount').value.trim();
  if (!/^\d+$/.test(amountRaw)) return showError(err, new Error('Amount must be a positive whole number.'));
  const ok = await mutate(() => api.placeBet(player, type, v.value, Number(amountRaw)), err);
  if (ok) toast(`${player}: ${betLabel(type, v.value)} for ${money(Number(amountRaw))}.`, 'success');
});

async function cancelBet(id) {
  const ok = await mutate(() => api.cancelBet(id), $('bet-error'));
  if (ok) toast(`Bet #${id} cancelled.`);
}

// ---------- inspector ----------
async function inspect(n) {
  try {
    const info = await api.pocket(n);
    app.inspected = info.number;
    renderInspector(info);
    wheel.setSelected(info.number);
    list.setSelected(info.number, info.neighbors);
    if (['STRAIGHT', 'NEIGHBORS'].includes(betType())) setNumberValue($('bet-value-wrap'), info.number);
  } catch (err) {
    showError(null, err);
  }
}

function numButton(n, extraClass = '') {
  return h('button', {
    type: 'button', class: `num-chip chip-${(colorOf(n) ?? 'black').toLowerCase()} ${extraClass}`,
    'aria-label': `Inspect pocket ${n}`, onclick: () => inspect(n), text: n,
  });
}

function renderInspector(info) {
  const host = $('inspector');
  host.replaceChildren(
    h('div', { class: 'insp-head' },
      h('div', { class: `insp-num chip-${info.color.toLowerCase()}`, text: info.number }),
      h('div', {},
        h('div', { class: 'insp-color', text: colorName(info.color) }),
        h('code', { class: 'insp-code', text: `wheel.node_of(${info.number})` }))),
    h('div', { class: 'insp-links' },
      h('div', { class: 'insp-link' }, h('span', { class: 'lbl lbl-prev', text: '◀ previous' }), numButton(info.previous)),
      h('div', { class: 'insp-link' }, h('span', { class: 'lbl lbl-next', text: 'next ▶' }), numButton(info.next))),
    h('div', { class: 'insp-nb' },
      h('span', { class: 'lbl', text: 'neighbors(radius=2)' }),
      h('div', { class: 'nb-row' }, info.neighbors.map((n) => numButton(n, n === info.number ? 'is-center' : '')))));
}

$('inspect-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('inspect-number').value.trim();
  if (raw === '') return toast('Enter a pocket number (0–36).', 'error');
  inspect(raw);
});

// ---------- spin ----------
async function doSpin(steps, errEl) {
  if (app.spinning) return;
  setBusy(true);
  let outcome;
  try {
    outcome = await api.spin(steps);
    clearError(errEl);
  } catch (err) {
    setBusy(false);
    showError(errEl, err);
    return;
  }
  app.lastOutcome = outcome;
  historyView.noteRecord();
  renderStepsReadout(outcome);
  $('btn-replay').disabled = false;

  felt.clearResult();
  const token = newListToken();
  const replay = list.replaySpin(outcome, token).finally(() => listDone(token));
  await wheel.spin(outcome);

  // Landing: reveal + settlements right away, then the cloth pays / sweeps the chips.
  renderWheelCaption(outcome.state.wheel);
  renderResult($('result-badge'), outcome.result, outcome.state.round);
  renderSettlements($('settle-table'), outcome.settlements);
  announce(outcome);
  await felt.settle(outcome);

  setBusy(false);
  applyState(outcome.state);
  await replay;
}

function renderStepsReadout(o) {
  $('steps-readout').replaceChildren(
    h('div', { class: 'readout-row' },
      h('span', { class: 'lbl lbl-next', text: 'wheel' }),
      h('code', { text: `${o.wheel_steps} % 37 = ${o.effective_wheel_steps}` }),
      h('span', { class: 'muted', text: ` hops via next · marker ${o.marker_before} → ${o.marker_after}` })),
    h('div', { class: 'readout-row' },
      h('span', { class: 'lbl lbl-prev', text: 'ball' }),
      h('code', { text: `${o.ball_steps} % 37 = ${o.effective_ball_steps}` }),
      h('span', { class: 'muted', text: ` hops via previous · lands on ${o.result.number}` })));
}

function announce(o) {
  const head = `${o.result.number} ${colorName(o.result.color)}`;
  if (!o.settlements.length) return toast(`Ball landed on ${head}.`);
  const byPlayer = new Map();
  for (const s of o.settlements) byPlayer.set(s.player, (byPlayer.get(s.player) ?? 0) + s.delta);
  const parts = [...byPlayer].map(([p, d]) => `${p} ${signed(d)}`);
  toast(`${head} — ${parts.join(', ')}`, o.settlements.some((s) => s.won) ? 'success' : 'info', 5500);
}

$('btn-spin').addEventListener('click', () => doSpin({}, $('spin-error')));

$('manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const w = $('wheel-steps').value.trim();
  const b = $('ball-steps').value.trim();
  if (!/^\d+$/.test(w) || !/^\d+$/.test(b)) {
    return showError($('spin-error'), new Error('Steps must be non-negative whole numbers.'));
  }
  doSpin({ wheel_steps: Number(w), ball_steps: Number(b) }, $('spin-error'));
});

// ---------- list view controls ----------
async function traverse(direction) {
  if (app.spinning) return;
  try {
    const resp = await api.order(direction);
    const token = newListToken();
    await list.traverse(resp, token);
    listDone(token);
  } catch (err) {
    showError(null, err);
  }
}

$('btn-fwd').addEventListener('click', () => traverse('forward'));
$('btn-bwd').addEventListener('click', () => traverse('backward'));
$('btn-replay').addEventListener('click', async () => {
  if (!app.lastOutcome || app.spinning) return;
  const token = newListToken();
  await list.replaySpin(app.lastOutcome, token);
  listDone(token);
});
$('btn-skip').addEventListener('click', () => { if (app.listToken) app.listToken.cancelled = true; });

// ---------- history ----------
async function moveCursor(direction) {
  const size = app.state?.history.size ?? 0;
  if (!size) return toast('History is empty: spin first.', 'error');
  const ok = await mutate(() => api.moveCursor(direction), null);
  if (ok) { historyView.noteMove(direction, size); historyView.render(ok.history); }
}
$('btn-older').addEventListener('click', () => moveCursor('older'));
$('btn-newer').addEventListener('click', () => moveCursor('newer'));

// ---------- reset / demo ----------
async function reset(demo) {
  const ok = await mutate(() => api.reset(demo), null);
  if (!ok) return;
  app.lastOutcome = null;
  app.inspected = null;
  historyView.noteRecord();
  wheel.hideBall();
  felt.clearResult();
  wheel.setSelected(null);
  list.setSelected(null);
  list.clearTrail();
  list.setCaption('idle');
  $('btn-replay').disabled = true;
  $('steps-readout').replaceChildren();
  $('inspector').replaceChildren(h('p', { class: 'muted', text: 'Click a pocket on the wheel or a node in the list.' }));
  renderResult($('result-badge'), null);
  renderSettlements($('settle-table'), null);
  applyState(ok);
  toast(demo ? 'Demo loaded: Ana and Luis sit down with $100 each.' : 'Table reset.', 'success');
}
$('btn-reset').addEventListener('click', () => reset(false));
$('btn-demo').addEventListener('click', () => reset(true));

// ---------- boot ----------
async function boot() {
  $('mock-pill').hidden = !USE_MOCK;
  try {
    applyState(await api.state());
    const lh = $('list-host');
    lh.scrollLeft = (lh.scrollWidth - lh.clientWidth) / 2;
  } catch (err) {
    $('wheel-caption').textContent = 'Could not load the game state from the API.';
    showError(null, err);
  }
}
boot();
