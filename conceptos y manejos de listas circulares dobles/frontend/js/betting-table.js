// Felt betting table (European layout) with a chip rack and chip stacks.
// - Pocket colors come from the API (state.wheel.pockets), never hardcoded.
// - Bets are created/removed through the API; stacks are drawn from state.pending_bets.
// - Win/lose comes from SpinOutcome.settlements; nothing is evaluated here.
// The only fixed knowledge is the physical layout of the cloth (where each cell sits).

import { h, money, signed, wait, prefersReducedMotion, colorName } from './util.js';

export const CHIP_VALUES = [1, 5, 10, 25, 100];
const MAX_VISIBLE = 8;

/** Physical position of number n on the cloth: 3 rows x 12 columns, 3-6-9… on top. */
function cellPos(n) {
  const col = Math.ceil(n / 3);
  const row = 3 - ((n - 1) % 3);
  return { col: col + 1, row };
}

const keyOf = (type, value) => `${type}:${value}`;

/** Purely cosmetic: which chip colour to draw for an arbitrary amount. */
function denomFor(amount) {
  let d = CHIP_VALUES[0];
  for (const v of CHIP_VALUES) if (amount >= v) d = v;
  return d;
}

function chipEl(value, { tag = 'span', cls = '', label } = {}) {
  return h(tag, { class: `chip chip-d${value} ${cls}` }, h('span', { class: 'chip-face', text: label ?? value }));
}

export class BettingTable {
  constructor(host, { onPlace, onRemove, onFocusBet, onChipChange } = {}) {
    this.host = host;
    this.onPlace = onPlace;
    this.onRemove = onRemove;
    this.onFocusBet = onFocusBet;
    this.onChipChange = onChipChange;
    this.chip = 10;
    this.cells = new Map();        // key -> cell element
    this.numberCells = new Map();  // number -> cell element
    this.resultNumber = null;
    this.playerColors = new Map();
    this.disabled = false;
    this.settling = false;
    this.#buildChrome();
  }

  #buildChrome() {
    this.rack = h('div', { class: 'rack', role: 'radiogroup', 'aria-label': 'Chip value' },
      CHIP_VALUES.map((v) => {
        const b = chipEl(v, { tag: 'button', cls: 'rack-chip' });
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', `Chip ${money(v)}`);
        b.dataset.value = v;
        b.addEventListener('click', () => this.setChip(v, true));
        b.addEventListener('keydown', (e) => {
          const i = CHIP_VALUES.indexOf(this.chip);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); this.setChip(CHIP_VALUES[(i + 1) % CHIP_VALUES.length], true, true); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.setChip(CHIP_VALUES[(i - 1 + CHIP_VALUES.length) % CHIP_VALUES.length], true, true); }
        });
        return b;
      }));
    this.who = h('p', { class: 'felt-who', 'aria-live': 'polite' });
    this.grid = h('div', { class: 'felt-grid', role: 'group', 'aria-label': 'Betting layout' });
    this.neighbors = h('div', { class: 'felt-neighbors' });
    this.host.replaceChildren(
      h('div', { class: 'felt-head' },
        h('div', { class: 'rack-wrap' }, h('span', { class: 'lbl', text: 'Chip' }), this.rack),
        this.who),
      h('div', { class: 'felt-scroll' }, h('div', { class: 'felt-cloth' }, this.grid)),
      this.neighbors,
      h('p', { class: 'hint felt-hint' },
        'Click a cell to bet the selected chip (repeat to add more). ',
        h('kbd', { text: 'Shift' }), ' / ', h('kbd', { text: 'Alt' }),
        ' + click a pocket on the wheel to bet NEIGHBORS. Right-click a cell or press × to remove its top chip.'));
    this.setChip(this.chip, false);
  }

  setChip(v, notify, focus = false) {
    this.chip = v;
    this.rack.querySelectorAll('.rack-chip').forEach((b) => {
      const on = Number(b.dataset.value) === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('selected', on);
      if (on && focus) b.focus();
    });
    if (notify) this.onChipChange?.(v);
  }

  setPlayer(name, color) {
    this.player = name;
    this.who.replaceChildren(...(name
      ? ['Betting as ', h('span', { class: 'who-dot', style: `--pc:${color}`, 'aria-hidden': 'true' }), h('strong', { text: name }),
        h('span', { class: 'muted', text: ' · pick another player in the Players panel' })]
      : [h('span', { class: 'muted', text: 'Add a player to start betting.' })]));
  }

  /** Builds the cloth from API data and draws pending bets as chip stacks. */
  render(state, { playerColors, disabled }) {
    if (this.settling) return;
    this.playerColors = playerColors;
    this.disabled = disabled;
    const colors = new Map(state.wheel.pockets.map((p) => [p.number, p.color]));
    this.cells.clear();
    this.numberCells.clear();

    const cells = [];
    const add = (key, type, value, labelNode, style, cls, aria) => {
      const cell = this.#cell(key, type, value, labelNode, style, cls, aria);
      cells.push(cell);
      return cell;
    };

    const zeroColor = (colors.get(0) ?? 'GREEN').toLowerCase();
    this.numberCells.set(0, add(keyOf('STRAIGHT', 0), 'STRAIGHT', 0, h('span', { class: 'num', text: '0' }),
      'grid-column:1;grid-row:1 / 4', `cell-num cell-zero cell-${zeroColor}`, `0 ${colorName(colors.get(0))}, straight`));
    for (let n = 1; n <= 36; n++) {
      const { col, row } = cellPos(n);
      const c = (colors.get(n) ?? 'BLACK');
      this.numberCells.set(n, add(keyOf('STRAIGHT', n), 'STRAIGHT', n, h('span', { class: 'num', text: n }),
        `grid-column:${col};grid-row:${row}`, `cell-num cell-${c.toLowerCase()}`, `${n} ${colorName(c)}, straight`));
    }
    [['1', '1st 12'], ['2', '2nd 12'], ['3', '3rd 12']].forEach(([d, label], i) => {
      add(keyOf('DOZEN', Number(d)), 'DOZEN', Number(d), h('span', { class: 'out-label', text: label }),
        `grid-column:${2 + i * 4} / span 4;grid-row:4`, 'cell-out', `${label} dozen`);
    });
    const diamond = (c) => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 60 30');
      s.setAttribute('class', `diamond diamond-${c.toLowerCase()}`);
      s.setAttribute('aria-hidden', 'true');
      s.innerHTML = '<path d="M30 2 L58 15 L30 28 L2 15 Z"/>';
      return s;
    };
    const outside = [
      ['PARITY', 'EVEN', h('span', { class: 'out-label', text: 'EVEN' }), 'Even'],
      ['COLOR', 'RED', diamond('RED'), 'Red'],
      ['COLOR', 'BLACK', diamond('BLACK'), 'Black'],
      ['PARITY', 'ODD', h('span', { class: 'out-label', text: 'ODD' }), 'Odd'],
    ];
    outside.forEach(([type, value, node, aria], i) => {
      add(keyOf(type, value), type, value, node, `grid-column:${2 + i * 3} / span 3;grid-row:5`, 'cell-out', aria);
    });
    cells.push(h('div', { class: 'felt-corner', style: 'grid-column:1;grid-row:4 / 6', 'aria-hidden': 'true' },
      h('span', { text: 'Roulette Ring' })));
    this.grid.replaceChildren(...cells);

    // Stacks.
    const byKey = new Map();
    const neighborBets = new Map();
    for (const b of state.pending_bets) {
      const k = keyOf(b.type, b.value);
      if (b.type === 'NEIGHBORS') {
        if (!neighborBets.has(k)) neighborBets.set(k, []);
        neighborBets.get(k).push(b);
        continue;
      }
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(b);
    }
    for (const [k, bets] of byKey) {
      const cell = this.cells.get(k);
      if (cell) this.#drawStack(cell, bets);
    }
    this.#renderNeighbors(neighborBets, colors);
    if (this.resultNumber !== null) this.#placeDolly(this.resultNumber, false);
  }

  #cell(key, type, value, labelNode, style, cls, aria) {
    const hit = h('button', {
      type: 'button', class: 'cell-hit', 'data-mutates': true, disabled: this.disabled,
      'aria-label': `Bet chip on ${aria}`,
    });
    hit.addEventListener('click', () => this.onPlace?.(type, value, this.chip));
    const cell = h('div', { class: `cell ${cls}`, style, 'data-key': key }, hit, h('span', { class: 'cell-label', 'aria-hidden': 'true' }, labelNode));
    cell.addEventListener('contextmenu', (e) => {
      const top = cell._bets?.at(-1);
      if (!top) return;
      e.preventDefault();
      if (!this.disabled) this.onRemove?.(top.id);
    });
    this.cells.set(key, cell);
    return cell;
  }

  #drawStack(cell, bets) {
    cell._bets = bets;
    cell.classList.add('has-bets');
    const total = bets.reduce((s, b) => s + b.amount, 0);
    const visible = bets.slice(-MAX_VISIBLE);
    const stack = h('div', { class: 'stack', 'aria-hidden': 'true' },
      visible.map((b, i) => {
        const c = chipEl(denomFor(b.amount), { cls: 'stack-chip', label: i === visible.length - 1 ? b.player.slice(0, 1).toUpperCase() : '' });
        c.style.setProperty('--i', i);
        c.style.setProperty('--pc', this.playerColors.get(b.player) ?? '#f4ecd8');
        c.dataset.betId = b.id;
        c.dataset.player = b.player;
        c.title = `#${b.id} ${b.player} ${money(b.amount)}`;
        return c;
      }),
      h('span', { class: 'stack-total', text: money(total) }));
    const top = bets.at(-1);
    const remove = h('button', {
      type: 'button', class: 'stack-x', 'data-mutates': true, disabled: this.disabled,
      'aria-label': `Remove top chip (bet ${top.id}, ${top.player}, ${money(top.amount)})`, title: 'Remove top chip',
      onclick: (e) => { e.stopPropagation(); this.onRemove?.(top.id); },
    }, '×');
    const hover = () => this.onFocusBet?.(top);
    const leave = () => this.onFocusBet?.(null);
    cell.addEventListener('mouseenter', hover);
    cell.addEventListener('mouseleave', leave);
    const hit = cell.querySelector('.cell-hit');
    hit.addEventListener('focus', hover);
    hit.addEventListener('blur', leave);
    hit.setAttribute('aria-label', `${hit.getAttribute('aria-label')}. ${bets.length} chip${bets.length > 1 ? 's' : ''}, ${money(total)} on it.`);
    cell.append(stack, remove);
  }

  #renderNeighbors(neighborBets, colors) {
    if (!neighborBets.size) {
      this.neighbors.replaceChildren();
      this.neighbors.hidden = true;
      return;
    }
    this.neighbors.hidden = false;
    const items = [...neighborBets].map(([k, bets]) => {
      const center = bets[0].value;
      const cell = h('div', { class: 'cell cell-out cell-nb', 'data-key': k },
        (() => {
          const hit = h('button', { type: 'button', class: 'cell-hit', 'data-mutates': true, disabled: this.disabled, 'aria-label': `Bet chip on neighbors of ${center}` });
          hit.addEventListener('click', () => this.onPlace?.('NEIGHBORS', center, this.chip));
          return hit;
        })(),
        h('span', { class: 'cell-label nb-label', 'aria-hidden': 'true' },
          h('span', { class: 'out-label', text: `Neighbors ${center}` }),
          h('span', { class: 'nb-nums' }, bets[0].covered.map((n) => h('span', { class: `mini chip-${(colors.get(n) ?? 'BLACK').toLowerCase()}`, text: n })))));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.disabled) this.onRemove?.(bets.at(-1).id); });
      this.cells.set(k, cell);
      this.#drawStack(cell, bets);
      return cell;
    });
    this.neighbors.replaceChildren(h('span', { class: 'lbl', text: 'Neighbor bets' }), ...items);
  }

  /** Highlights the numbers a hovered bet covers (numbers come from the API). */
  setFocus(numbers) {
    const set = new Set(numbers);
    for (const [n, cell] of this.numberCells) cell.classList.toggle('is-covered', set.has(n));
  }

  #placeDolly(n, animate = true) {
    const cell = this.numberCells.get(n);
    if (!cell) return;
    cell.classList.add('is-winner');
    if (!cell.querySelector('.dolly')) cell.append(h('span', { class: animate ? 'dolly' : 'dolly no-anim', 'aria-hidden': 'true' }));
  }

  clearResult() {
    this.resultNumber = null;
    this.grid.querySelectorAll('.dolly').forEach((d) => d.remove());
    this.grid.querySelectorAll('.is-winner, .won-cell').forEach((c) => c.classList.remove('is-winner', 'won-cell'));
  }

  /**
   * Plays the settlement on the cloth: dolly on the result, winning stacks glow and fly to
   * their player with "+amount", losing chips are swept to the dealer. Uses settlements only.
   */
  async settle(outcome) {
    this.resultNumber = outcome.result.number;
    this.#placeDolly(this.resultNumber);
    const byId = new Map(outcome.settlements.map((s) => [s.bet_id, s]));
    const chips = [...this.host.querySelectorAll('.stack-chip')];
    if (!chips.length || prefersReducedMotion()) return;
    this.settling = true;

    // 1. Glow / dim.
    const winCells = new Map();
    for (const cell of this.cells.values()) {
      const bets = cell._bets ?? [];
      const settled = bets.map((b) => byId.get(b.id)).filter(Boolean);
      if (settled.some((s) => s.won)) {
        cell.classList.add('won-cell');
        winCells.set(cell, settled.filter((s) => s.won).reduce((a, s) => a + s.delta, 0));
      } else if (settled.length) {
        cell.classList.add('lost-cell');
      }
    }
    for (const [cell, delta] of winCells) {
      cell.append(h('span', { class: 'float-win', text: signed(delta) }));
    }
    await wait(1100);

    // 2. Pay winners toward their player card, sweep losers to the dealer (top-left).
    // Chips are cloned into a fixed overlay so they can leave the scrollable cloth.
    const hostRect = this.host.getBoundingClientRect();
    const layer = h('div', { class: 'chip-flight-layer', 'aria-hidden': 'true' });
    document.body.append(layer);
    const flights = chips.map((chip, i) => {
      const s = byId.get(Number(chip.dataset.betId));
      const r = chip.getBoundingClientRect();
      const clone = chip.cloneNode(true);
      clone.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;transform:none;`;
      clone.style.setProperty('--i', 0);
      layer.append(clone);
      chip.style.visibility = 'hidden';
      let dx;
      let dy;
      if (s?.won) {
        const card = document.querySelector(`.player[data-player="${CSS.escape(chip.dataset.player)}"] .avatar`);
        const t = card?.getBoundingClientRect();
        const visible = t && t.bottom > 0 && t.top < innerHeight;
        dx = visible ? t.left + t.width / 2 - (r.left + r.width / 2) : 0;
        dy = visible ? t.top + t.height / 2 - (r.top + r.height / 2) : -160;
        clone.classList.add('fly');
      } else {
        dx = hostRect.left + 24 - r.left;
        dy = hostRect.top - 20 - r.top;
        clone.classList.add('swept');
      }
      clone.style.transitionDelay = `${i * 28}ms`;
      return () => { clone.style.translate = `${dx}px ${dy}px`; };
    });
    requestAnimationFrame(() => requestAnimationFrame(() => flights.forEach((go) => go())));
    this.host.querySelectorAll('.stack-total, .stack-x').forEach((el) => el.classList.add('fade-out'));
    await wait(1100 + chips.length * 28);
    layer.remove();
    this.settling = false;
  }
}
