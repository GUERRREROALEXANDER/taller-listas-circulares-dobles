// Linked list visualization: the 37 nodes of the wheel drawn as a ring with
// `next` (outer) and `previous` (inner) links, HEAD / TAIL / MARKER badges, and
// step-by-step replays of paths that the API returned (wheel_path, ball_path,
// and /api/wheel/order traversals). No list logic: positions follow the API order.

import { svg, h, polar, arcPath, tween, wait, prefersReducedMotion, easeInOutSine, colorName } from './util.js';

const R = 330;
const NODE_R = 16;
const PHI = 3.3;   // angular gap between a node centre and the start of an arrow (deg)
const LINK_OFFSET = 8;

const SPIN_CODE = [
  'for _ in range(wheel_steps % 37):',
  '    marker = marker.next',
  'ball = marker',
  'for _ in range(ball_steps % 37):',
  '    ball = ball.previous',
  'result = ball.value',
];
const traverseCode = (dir) => [
  'node = start            # marker',
  'while True:             # do / while',
  '    visit(node)',
  `    node = node.${dir === 'forward' ? 'next' : 'previous'}`,
  '    if node is start: break',
];

export class ListView {
  constructor(host, { onNodeClick, captionEl, trailEl, codeEl } = {}) {
    this.host = host;
    this.onNodeClick = onNodeClick;
    this.captionEl = captionEl;
    this.trailEl = trailEl;
    this.codeEl = codeEl;
    this.order = [];
    this.index = new Map();
    this.pockets = new Map();   // number -> pocket dict from the API
    this.nodes = new Map();     // number -> <g>
    this.nextArrows = [];       // by list index of the source node
    this.prevArrows = [];       // by list index of the source node
    this.wheel = null;
    this.busy = false;
    this.#buildStatic();
    this.setCode(SPIN_CODE, -1);
  }

  get theta() { return 360 / this.order.length; }
  angleOf(number) { return this.index.get(number) * this.theta; }

  #buildStatic() {
    const root = svg('svg', { viewBox: '-415 -415 830 830', class: 'list-svg', role: 'group', 'aria-label': 'Circular doubly linked list of pockets' });
    const defs = svg('defs', {}, root);
    const arrow = (id, color) => {
      const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      svg('path', { d: 'M0 0 L10 5 L0 10 Z', fill: color }, m);
    };
    arrow('ah-next', '#a8913f');
    arrow('ah-prev', '#3f8f88');
    arrow('ah-next-on', '#f3d36b');
    arrow('ah-prev-on', '#6ee7dc');
    arrow('ah-trav', '#f4ecd8');

    svg('circle', { r: R, class: 'ring-guide' }, root);
    this.linkLayer = svg('g', { class: 'links' }, root);
    this.nodeLayer = svg('g', { class: 'nodes' }, root);
    this.badgeLayer = svg('g', { class: 'badges', 'aria-hidden': 'true' }, root);

    this.pointer = svg('g', { class: 'pointer', opacity: 0, 'aria-hidden': 'true' }, root);
    svg('circle', { r: NODE_R + 7, class: 'pointer-ring' }, this.pointer);

    // Centre card: the node the pointer is on.
    const card = svg('g', { class: 'center-card', 'aria-hidden': 'true' }, root);
    svg('circle', { r: 150, class: 'center-disc' }, card);
    this.cPhase = svg('text', { y: -78, class: 'c-phase', 'text-anchor': 'middle' }, card);
    this.cNumber = svg('text', { y: 8, class: 'c-number', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, card);
    this.cColor = svg('text', { y: 62, class: 'c-color', 'text-anchor': 'middle' }, card);
    this.cLinks = svg('text', { y: 96, class: 'c-links', 'text-anchor': 'middle' }, card);
    this.cStep = svg('text', { y: -50, class: 'c-step', 'text-anchor': 'middle' }, card);

    this.badges = {
      head: this.#badge('HEAD', 'badge-head'),
      tail: this.#badge('TAIL', 'badge-tail'),
      marker: this.#badge('MARKER', 'badge-marker'),
    };

    this.svg = root;
    this.host.appendChild(root);
  }

  #badge(label, cls) {
    const g = svg('g', { class: `badge ${cls}` }, this.badgeLayer);
    const w = label.length * 9 + 16;
    svg('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 11 }, g);
    const t = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    t.textContent = label;
    return g;
  }

  render(wheel) {
    this.wheel = wheel;
    const order = wheel.pockets.map((p) => p.number);
    if (order.join(',') !== this.order.join(',')) this.#build(wheel.pockets);
    wheel.pockets.forEach((p) => this.pockets.set(p.number, p));
    this.#placeBadge(this.badges.head, wheel.head, R + 46);
    this.#placeBadge(this.badges.tail, wheel.tail, R + 46);
    if (!this.busy) this.#placeBadge(this.badges.marker, wheel.marker, R - 50);
    for (const [n, g] of this.nodes) g.classList.toggle('is-marker', n === wheel.marker && !this.busy);
    if (!this.busy) this.#showCard(wheel.marker, 'marker');
  }

  #build(pockets) {
    this.linkLayer.replaceChildren();
    this.nodeLayer.replaceChildren();
    this.nodes.clear();
    this.index.clear();
    this.nextArrows = [];
    this.prevArrows = [];
    this.order = pockets.map((p) => p.number);
    const th = this.theta;

    pockets.forEach((p, i) => {
      this.index.set(p.number, i);
      const a = i * th;
      // next: node i -> node i+1, outer lane, clockwise.
      this.nextArrows[i] = svg('path', {
        d: arcPath(R + LINK_OFFSET, a + PHI, a + th - PHI), class: 'link link-next', 'marker-end': 'url(#ah-next)',
      }, this.linkLayer);
      // previous: node i -> node i-1, inner lane, counter-clockwise.
      this.prevArrows[i] = svg('path', {
        d: arcPath(R - LINK_OFFSET, a - PHI, a - th + PHI), class: 'link link-prev', 'marker-end': 'url(#ah-prev)',
      }, this.linkLayer);
    });

    pockets.forEach((p, i) => {
      const [x, y] = polar(R, i * th);
      const g = svg('g', {
        class: `node node-${p.color.toLowerCase()}`, transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
        tabindex: 0, role: 'button', 'data-number': p.number,
        'aria-label': `Node ${p.number}, ${colorName(p.color)}. previous ${p.previous}, next ${p.next}. Press Enter to inspect.`,
      }, this.nodeLayer);
      svg('circle', { r: NODE_R + 5, class: 'node-halo' }, g);
      svg('circle', { r: NODE_R, class: 'node-body' }, g);
      const t = svg('text', { class: 'node-num', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = p.number;
      g.addEventListener('click', () => this.onNodeClick?.(p.number));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onNodeClick?.(p.number); }
      });
      this.nodes.set(p.number, g);
    });
  }

  #placeBadge(badge, number, radius) {
    if (!this.index.has(number)) return;
    const [x, y] = polar(radius, this.angleOf(number));
    badge.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  }

  #showCard(number, phase, step = '') {
    const p = this.pockets.get(number);
    if (!p) return;
    this.cPhase.textContent = phase;
    this.cStep.textContent = step;
    this.cNumber.textContent = p.number;
    this.cNumber.setAttribute('class', `c-number c-${p.color.toLowerCase()}`);
    this.cColor.textContent = colorName(p.color).toUpperCase();
    this.cLinks.textContent = `◀ prev ${p.previous}   ·   next ${p.next} ▶`;
  }

  setCaption(code, step = '') {
    if (!this.captionEl) return;
    this.captionEl.replaceChildren(h('code', { text: code }), step ? h('span', { class: 'cc-step', text: step }) : '');
  }

  setCode(lines, active) {
    if (!this.codeEl) return;
    this.codeEl.replaceChildren(...lines.map((line, i) => h('span', { class: i === active ? 'line active' : 'line', text: line })));
  }

  setSelected(number, neighbors = []) {
    const nb = new Set(neighbors);
    for (const [n, g] of this.nodes) {
      g.classList.toggle('selected', n === number);
      g.classList.toggle('neighbor', n !== number && nb.has(n));
    }
  }

  clearTrail() {
    for (const a of this.nextArrows) { a.classList.remove('on', 'trail'); a.setAttribute('marker-end', 'url(#ah-next)'); }
    for (const a of this.prevArrows) { a.classList.remove('on', 'trail', 'trav'); a.setAttribute('marker-end', 'url(#ah-prev)'); }
    for (const a of this.nextArrows) a.classList.remove('trav');
    for (const g of this.nodes.values()) g.classList.remove('visit-next', 'visit-prev', 'visit-trav', 'is-result');
    this.trailEl?.replaceChildren();
  }

  #addTrail(number, kind) {
    const p = this.pockets.get(number);
    if (!this.trailEl || !p) return;
    this.trailEl.append(h('li', { class: `trail-chip trail-${kind} chip-${p.color.toLowerCase()}`, text: number }));
  }

  #light(arrow, kind) {
    if (!arrow) return;
    arrow.classList.add(kind === 'trav' ? 'trav' : 'on');
    arrow.setAttribute('marker-end', `url(#ah-${kind === 'trav' ? 'trav' : kind + '-on'})`);
  }

  #dim(arrow) {
    if (!arrow) return;
    if (arrow.classList.contains('on')) arrow.classList.replace('on', 'trail');
  }

  #movePointer(fromNumber, toNumber, clockwise, ms, token) {
    const a0 = this.angleOf(fromNumber);
    let a1 = this.angleOf(toNumber);
    if (clockwise && a1 < a0) a1 += 360;
    if (!clockwise && a1 > a0) a1 -= 360;
    return tween(ms, (t) => {
      const [x, y] = polar(R, a0 + (a1 - a0) * easeInOutSine(t));
      this.pointer.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    }, token);
  }

  #pointerAt(number, kind) {
    const [x, y] = polar(R, this.angleOf(number));
    this.pointer.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    this.pointer.setAttribute('class', `pointer pointer-${kind}`);
    this.pointer.setAttribute('opacity', 1);
  }

  /**
   * Walks a path the API returned. `linkOf(fromNumber)` says which arrow to light.
   * Every hop must be a real link (to === pockets[from].next / .previous).
   */
  async #walk({ start, path, kind, clockwise, label, codeLine, phase, onStep, token }) {
    const n = path.length;
    const stepMs = Math.max(110, Math.min(430, 3800 / Math.max(1, n)));
    let current = start;
    this.#pointerAt(start, kind);
    for (let k = 0; k < n; k++) {
      if (token.cancelled) break;
      const to = path[k];
      const p = this.pockets.get(current);
      const linked = clockwise ? p?.next === to : p?.previous === to;
      const arrows = clockwise ? this.nextArrows : this.prevArrows;
      const arrow = linked ? arrows[this.index.get(current)] : null;
      const stepTxt = `(${k + 1}/${n})`;
      this.setCaption(label, stepTxt);
      this.setCode(this.codeLines, codeLine);
      this.#light(arrow, kind);
      await this.#movePointer(current, to, clockwise, stepMs * 0.75, token);
      if (kind !== 'trav') this.#dim(arrow);
      this.nodes.get(to)?.classList.add(`visit-${kind}`);
      this.#addTrail(to, kind);
      this.#showCard(to, phase, stepTxt);
      onStep?.(to);
      current = to;
      await wait(stepMs * 0.25, token);
    }
    return current;
  }

  #finishInstantly(outcome) {
    // Final state of a spin replay, used for skip and reduced motion.
    this.clearTrail();
    let prev = outcome.marker_before;
    for (const to of outcome.wheel_path) {
      const a = this.nextArrows[this.index.get(prev)];
      if (this.pockets.get(prev)?.next === to && a) { a.classList.add('trail'); a.setAttribute('marker-end', 'url(#ah-next-on)'); }
      this.nodes.get(to)?.classList.add('visit-next');
      this.#addTrail(to, 'next');
      prev = to;
    }
    prev = outcome.marker_after;
    for (const to of outcome.ball_path) {
      const a = this.prevArrows[this.index.get(prev)];
      if (this.pockets.get(prev)?.previous === to && a) { a.classList.add('trail'); a.setAttribute('marker-end', 'url(#ah-prev-on)'); }
      this.nodes.get(to)?.classList.add('visit-prev');
      this.#addTrail(to, 'prev');
      prev = to;
    }
  }

  /** Replays a SpinOutcome: wheel_path via next, then ball_path via previous. */
  async replaySpin(outcome, token = {}) {
    this.busy = true;
    this.codeLines = SPIN_CODE;
    this.clearTrail();
    const res = outcome.result;
    const ew = outcome.effective_wheel_steps;
    const eb = outcome.effective_ball_steps;

    if (prefersReducedMotion()) {
      this.#finishInstantly(outcome);
    } else {
      this.#placeBadge(this.badges.marker, outcome.marker_before, R - 50);
      this.#showCard(outcome.marker_before, 'marker (before)', `wheel_steps ${outcome.wheel_steps} → ${ew}`);
      this.setCaption(`marker = node(${outcome.marker_before})`, `${ew} hop${ew === 1 ? '' : 's'} via next`);
      this.setCode(SPIN_CODE, 0);
      this.#pointerAt(outcome.marker_before, 'next');
      await wait(700, token);
      if (ew === 0 && !token.cancelled) {
        this.setCaption(`wheel_steps % 37 == 0`, 'marker stays');
        await wait(900, token);
      }
      await this.#walk({
        start: outcome.marker_before, path: outcome.wheel_path, kind: 'next', clockwise: true,
        label: 'marker = marker.next', codeLine: 1, phase: 'wheel_path', token,
        onStep: (n) => this.#placeBadge(this.badges.marker, n, R - 50),
      });
      if (!token.cancelled) {
        this.setCaption('ball = marker', `${eb} hop${eb === 1 ? '' : 's'} via previous`);
        this.setCode(SPIN_CODE, 2);
        this.#pointerAt(outcome.marker_after, 'prev');
        this.#showCard(outcome.marker_after, 'ball (start)', `ball_steps ${outcome.ball_steps} → ${eb}`);
        await wait(700, token);
      }
      await this.#walk({
        start: outcome.marker_after, path: outcome.ball_path, kind: 'prev', clockwise: false,
        label: 'ball = ball.previous', codeLine: 4, phase: 'ball_path', token,
      });
      if (token.cancelled) this.#finishInstantly(outcome);
    }

    this.#pointerAt(res.number, 'prev');
    this.#placeBadge(this.badges.marker, outcome.marker_after, R - 50);
    this.nodes.get(res.number)?.classList.add('is-result');
    this.#showCard(res.number, 'result', '');
    this.setCaption('result = ball.value', `${res.number} ${res.color}`);
    this.setCode(SPIN_CODE, 5);
    this.busy = false;
    if (this.wheel) {
      for (const [n, g] of this.nodes) g.classList.toggle('is-marker', n === outcome.marker_after);
    }
  }

  /** Animates GET /api/wheel/order: one full lap from the marker. */
  async traverse(resp, token = {}) {
    this.busy = true;
    const dir = resp.direction;
    this.codeLines = traverseCode(dir);
    this.clearTrail();
    const numbers = resp.order.map((p) => p.number);
    const forward = dir === 'forward';
    const link = forward ? 'next' : 'previous';
    const total = numbers.length;

    if (prefersReducedMotion()) {
      numbers.forEach((n) => { this.nodes.get(n)?.classList.add('visit-trav'); this.#addTrail(n, 'trav'); });
    } else {
      this.#pointerAt(resp.start, 'trav');
      this.nodes.get(resp.start)?.classList.add('visit-trav');
      this.#addTrail(resp.start, 'trav');
      this.#showCard(resp.start, 'start', `visit 1/${total}`);
      this.setCaption('node = start', `visit (1/${total})`);
      this.setCode(this.codeLines, 2);
      await wait(500, token);
      let current = resp.start;
      const stepMs = 150;
      for (let k = 1; k < total && !token.cancelled; k++) {
        const to = numbers[k];
        const arrows = forward ? this.nextArrows : this.prevArrows;
        this.#light(arrows[this.index.get(current)], 'trav');
        this.setCaption(`node = node.${link}`, `visit (${k + 1}/${total})`);
        this.setCode(this.codeLines, 3);
        await this.#movePointer(current, to, forward, stepMs, token);
        this.nodes.get(to)?.classList.add('visit-trav');
        this.#addTrail(to, 'trav');
        this.#showCard(to, `traverse ${dir}`, `visit ${k + 1}/${total}`);
        current = to;
      }
      if (!token.cancelled) {
        const arrows = forward ? this.nextArrows : this.prevArrows;
        this.#light(arrows[this.index.get(current)], 'trav');
        await this.#movePointer(current, resp.start, forward, stepMs * 2, token);
      }
      if (token.cancelled) {
        this.trailEl?.replaceChildren();
        numbers.forEach((n) => { this.nodes.get(n)?.classList.add('visit-trav'); this.#addTrail(n, 'trav'); });
      }
    }
    this.#pointerAt(resp.start, 'trav');
    this.#showCard(resp.start, 'back at start', `${total} nodes visited`);
    this.setCaption('node is start → stop', `${total} nodes, one lap`);
    this.setCode(this.codeLines, 4);
    this.busy = false;
  }
}
