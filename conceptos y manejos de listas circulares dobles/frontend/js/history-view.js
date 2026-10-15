// History ring (SpinHistory, capacity 10) + color stats bar.
// Slots are drawn from history.results (newest first, as returned by the API):
// newest at 12 o'clock, older results continue counter-clockwise (the
// `previous` direction), empty slots are dashed.

import { svg, h, polar, colorName } from './util.js';

const R = 82;
const SLOT_R = 17;

export class HistoryView {
  constructor(host, cursorEl, statsEl) {
    this.host = host;
    this.cursorEl = cursorEl;
    this.statsEl = statsEl;
    this.cursorSlot = 0; // only used to disambiguate repeated numbers in the ring
    this.svg = svg('svg', { viewBox: '-130 -130 260 260', class: 'history-svg', role: 'img', 'aria-label': 'Spin history ring' });
    host.appendChild(this.svg);
  }

  /** Called with the direction the user just moved, so repeated numbers resolve to the right slot. */
  noteMove(direction, size) {
    if (!size) return;
    this.cursorSlot = (this.cursorSlot + (direction === 'older' ? 1 : size - 1)) % size;
  }

  noteRecord() { this.cursorSlot = 0; }

  render(history) {
    const { capacity, size, results, cursor, stats } = history;
    const s = this.svg;
    s.replaceChildren();
    svg('circle', { r: R, class: 'hist-guide' }, s);

    // Which slot is the cursor? The API gives the pocket; match it, preferring the tracked slot.
    let cursorIdx = -1;
    if (cursor) {
      const matches = results.map((p, i) => (p.number === cursor.number ? i : -1)).filter((i) => i >= 0);
      cursorIdx = matches.includes(this.cursorSlot) ? this.cursorSlot : (matches[0] ?? -1);
      this.cursorSlot = cursorIdx < 0 ? 0 : cursorIdx;
    }

    const step = 360 / capacity;
    for (let k = 0; k < capacity; k++) {
      const a = -k * step;
      const [x, y] = polar(R, a);
      const g = svg('g', { transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})` }, s);
      const p = results[k];
      if (!p) {
        svg('circle', { r: SLOT_R, class: 'slot-empty' }, g);
        continue;
      }
      svg('circle', { r: SLOT_R, class: `slot slot-${p.color.toLowerCase()}${k === cursorIdx ? ' slot-cursor' : ''}` }, g);
      const t = svg('text', { class: 'slot-num', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = p.number;
      if (k === cursorIdx) svg('circle', { r: SLOT_R + 6, class: 'slot-cursor-ring' }, g);
    }

    if (size > 0) {
      this.#tag('newest', 0, step);
      if (size > 1) this.#tag('oldest', size - 1, step);
    }

    const center = svg('g', { class: 'hist-center' }, s);
    const l1 = svg('text', { y: -14, 'text-anchor': 'middle', class: 'hist-label' }, center);
    l1.textContent = cursor ? 'cursor' : 'empty';
    const l2 = svg('text', { y: 14, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: `hist-big ${cursor ? 'c-' + cursor.color.toLowerCase() : ''}` }, center);
    l2.textContent = cursor ? cursor.number : '–';
    const l3 = svg('text', { y: 40, 'text-anchor': 'middle', class: 'hist-label' }, center);
    l3.textContent = `${size}/${capacity}`;

    this.svg.setAttribute('aria-label', size
      ? `History ring, ${size} of ${capacity} slots used. Newest first: ${results.map((p) => p.number).join(', ')}.`
      : `History ring, empty, capacity ${capacity}.`);

    if (this.cursorEl) {
      this.cursorEl.textContent = cursor
        ? `Cursor on ${cursor.number} ${colorName(cursor.color)} (slot ${cursorIdx + 1} of ${size}, newest = 1). It wraps around.`
        : 'No spins recorded yet.';
    }
    this.#renderStats(stats);
  }

  #tag(label, k, step) {
    const [x, y] = polar(R + 33, -k * step);
    const t = svg('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'hist-tag', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, this.svg);
    t.textContent = label;
  }

  #renderStats(stats) {
    if (!this.statsEl) return;
    const keys = ['RED', 'BLACK', 'GREEN'];
    const total = keys.reduce((s, k) => s + (stats?.[k] ?? 0), 0);
    const bar = h('div', { class: 'stats-bar', role: 'img', 'aria-label': keys.map((k) => `${colorName(k)} ${stats?.[k] ?? 0}`).join(', ') });
    if (total === 0) bar.append(h('span', { class: 'stats-empty', text: 'No results yet' }));
    for (const k of keys) {
      const v = stats?.[k] ?? 0;
      if (!v) continue;
      bar.append(h('span', { class: `seg seg-${k.toLowerCase()}`, style: `flex-grow:${v}`, title: `${colorName(k)}: ${v}` }));
    }
    const legend = h('ul', { class: 'stats-legend' },
      keys.map((k) => h('li', {}, h('span', { class: `sw sw-${k.toLowerCase()}`, 'aria-hidden': 'true' }), `${colorName(k)} `, h('strong', { text: stats?.[k] ?? 0 }))));
    this.statsEl.replaceChildren(bar, legend);
  }
}
