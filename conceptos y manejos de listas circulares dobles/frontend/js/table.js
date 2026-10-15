// Players, bets, result badge and settlements rendering. Pure DOM output of API data.

import { h, money, signed, colorName } from './util.js';

const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function iconButton(label, onclick) {
  const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onclick, 'data-mutates': true });
  b.innerHTML = X_ICON;
  return b;
}

export function renderPlayers(listEl, players, { onRemove, onSelect, selected, colors }) {
  if (!players.length) {
    listEl.replaceChildren(h('li', { class: 'empty' }, 'No players yet. Add one or press ', h('strong', { text: 'Load demo' }), '.'));
    return;
  }
  listEl.replaceChildren(...players.map((p) => {
    const free = p.balance - p.committed;
    const pct = p.balance > 0 ? Math.min(100, (p.committed / p.balance) * 100) : 0;
    const isSel = p.name === selected;
    return h('li', { class: `player${isSel ? ' is-selected' : ''}`, 'data-player': p.name, style: `--pc:${colors.get(p.name) ?? '#f4ecd8'}` },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: p.name.slice(0, 1).toUpperCase() }),
      h('button', {
        type: 'button', class: 'player-main', 'aria-pressed': String(isSel),
        'aria-label': `Bet as ${p.name}. Balance ${money(p.balance)}, committed ${money(p.committed)}.`,
        onclick: () => onSelect(p.name),
      },
        h('span', { class: 'player-name' }, p.name, isSel ? h('span', { class: 'sel-tag', text: 'betting' }) : ''),
        h('span', { class: 'player-nums' },
          h('span', {}, 'Balance ', h('strong', { text: money(p.balance) })),
          h('span', {}, 'Committed ', h('strong', { class: p.committed ? 'gold' : '', text: money(p.committed) })),
          h('span', {}, 'Free ', h('strong', { text: money(free) }))),
        h('span', { class: 'meter', 'aria-hidden': 'true' },
          h('span', { style: `width:${pct}%` }))),
      iconButton(`Remove ${p.name}`, () => onRemove(p.name)));
  }));
}

export function renderPlayerSelect(selectEl, players) {
  const prev = selectEl.value;
  selectEl.replaceChildren(...(players.length
    ? players.map((p) => h('option', { value: p.name, text: `${p.name} (${money(p.balance - p.committed)} free)` }))
    : [h('option', { value: '', text: 'Add a player first' })]));
  if (players.some((p) => p.name === prev)) selectEl.value = prev;
  selectEl.disabled = !players.length;
}

export function betLabel(type, value) {
  switch (type) {
    case 'STRAIGHT': return `Straight ${value}`;
    case 'NEIGHBORS': return `Neighbors of ${value}`;
    case 'COLOR': return `${colorName(value)}`;
    case 'PARITY': return value === 'EVEN' ? 'Even' : 'Odd';
    case 'DOZEN': return `Dozen ${value} (${(value - 1) * 12 + 1}–${value * 12})`;
    default: return `${type} ${value}`;
  }
}

export function renderBets(listEl, countEl, bets, colorOf, { onCancel, onFocusBet }) {
  countEl.textContent = bets.length;
  if (!bets.length) {
    listEl.replaceChildren(h('li', { class: 'empty', text: 'No pending bets.' }));
    return;
  }
  listEl.replaceChildren(...bets.map((b) => {
    const li = h('li', { class: 'bet', tabindex: 0, 'aria-label': `Bet ${b.id}: ${b.player}, ${betLabel(b.type, b.value)}, ${money(b.amount)}. Covers ${b.covered.length} numbers.` },
      h('div', { class: 'bet-top' },
        h('span', { class: 'bet-id', text: `#${b.id}` }),
        h('span', { class: 'bet-player', text: b.player }),
        h('span', { class: 'bet-desc', text: betLabel(b.type, b.value) }),
        h('span', { class: 'bet-amount', text: money(b.amount) }),
        iconButton(`Cancel bet ${b.id}`, () => onCancel(b.id))),
      h('div', { class: 'covered', 'aria-hidden': 'true' },
        h('span', { class: 'covered-label', text: `covers ${b.covered.length}:` }),
        ...b.covered.map((n) => h('span', { class: `mini chip-${(colorOf(n) ?? 'black').toLowerCase()}`, text: n }))));
    const enter = () => onFocusBet(b);
    const leave = () => onFocusBet(null);
    li.addEventListener('mouseenter', enter);
    li.addEventListener('mouseleave', leave);
    li.addEventListener('focusin', enter);
    li.addEventListener('focusout', leave);
    return li;
  }));
}

function radioGroup(name, options) {
  return h('div', { class: 'segmented compact', role: 'radiogroup', 'aria-label': 'Bet value' },
    options.map(([value, label, cls], i) => h('label', { class: cls ?? '' },
      h('input', { type: 'radio', name, value, checked: i === 0 }),
      h('span', { text: label }))));
}

export function renderValueInput(wrap, type) {
  let content;
  if (type === 'STRAIGHT' || type === 'NEIGHBORS') {
    content = [
      h('label', { for: 'bet-value', text: type === 'STRAIGHT' ? 'Number (0–36)' : 'Center number (0–36)' }),
      h('input', { id: 'bet-value', type: 'number', inputmode: 'numeric', min: 0, max: 36, step: 1, value: wrap.dataset.lastNumber ?? 15 }),
      h('p', { class: 'hint', text: type === 'NEIGHBORS'
        ? 'Covers the number and 2 neighbors on each side of the wheel (the API resolves them). Tip: click a pocket.'
        : 'Tip: click a pocket on the wheel to pick it.' }),
    ];
  } else if (type === 'COLOR') {
    content = [h('span', { class: 'label', text: 'Color' }), radioGroup('bet-value', [['RED', 'Red', 'opt-red'], ['BLACK', 'Black', 'opt-black']])];
  } else if (type === 'PARITY') {
    content = [h('span', { class: 'label', text: 'Parity' }), radioGroup('bet-value', [['EVEN', 'Even'], ['ODD', 'Odd']])];
  } else {
    content = [h('span', { class: 'label', text: 'Dozen' }), radioGroup('bet-value', [['1', '1st · 1–12'], ['2', '2nd · 13–24'], ['3', '3rd · 25–36']])];
  }
  wrap.replaceChildren(...content);
}

export function readBetValue(wrap, type) {
  if (type === 'STRAIGHT' || type === 'NEIGHBORS') {
    const raw = wrap.querySelector('#bet-value')?.value ?? '';
    if (raw.trim() === '') return { error: 'Enter a number between 0 and 36.' };
    wrap.dataset.lastNumber = raw;
    return { value: Number(raw) };
  }
  const checked = wrap.querySelector('input[name="bet-value"]:checked');
  if (!checked) return { error: 'Choose a value.' };
  return { value: type === 'DOZEN' ? Number(checked.value) : checked.value };
}

export function setNumberValue(wrap, n) {
  const input = wrap.querySelector('#bet-value');
  if (input) { input.value = n; wrap.dataset.lastNumber = n; }
  return Boolean(input);
}

export function renderResult(badgeEl, result, round) {
  if (!result) {
    badgeEl.className = 'result-badge is-empty';
    badgeEl.replaceChildren(h('span', { class: 'result-number', text: '–' }), h('span', { class: 'result-color', text: 'No spins yet' }));
    return;
  }
  badgeEl.className = `result-badge res-${result.color.toLowerCase()} pop`;
  badgeEl.replaceChildren(
    h('span', { class: 'result-number', text: result.number }),
    h('span', { class: 'result-color', text: colorName(result.color) }));
  badgeEl.setAttribute('aria-label', `Last result ${result.number} ${colorName(result.color)}${round ? `, round ${round}` : ''}`);
}

export function renderSettlements(tableEl, settlements) {
  const body = tableEl.tBodies[0];
  if (!settlements || !settlements.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted', text: settlements ? 'No bets were on the table.' : 'No settlements yet.' })));
    return;
  }
  body.replaceChildren(...settlements.map((s) => h('tr', { class: s.won ? 'won' : 'lost' },
    h('td', { text: s.player }),
    h('td', { text: `${betLabel(s.type, s.value)} · ${money(s.amount)}` }),
    h('td', {}, h('span', { class: `pill ${s.won ? 'pill-won' : 'pill-lost'}`, text: s.won ? 'Won' : 'Lost' })),
    h('td', { class: `num ${s.delta >= 0 ? 'pos' : 'neg'}`, text: signed(s.delta) }),
    h('td', { class: 'num', text: money(s.balance_after) }))));
}
