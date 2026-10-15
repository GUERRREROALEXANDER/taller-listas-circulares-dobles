// SVG roulette wheel. Draws pockets clockwise in the order given by the API
// (state.wheel.pockets) and animates a spin outcome returned by POST /api/spin.
// It never decides where the wheel or the ball stop: it only aims at the
// numbers the API returned (marker_after and result.number).

import { svg, polar, sectorPath, arcPath, mod, tween, prefersReducedMotion, easeOutCubic, easeInOutSine, easeInQuad, colorName } from './util.js';

const R_RIM = 252;
const R_TRACK_OUT = 238;
const R_TRACK_IN = 204;
const R_BAND_OUT = 200;
const R_BAND_IN = 164;
const R_CUP_IN = 124;
const R_BALL_TRACK = 221;
const R_BALL_POCKET = 144;
const SPIN_MS = 7600;

export class Wheel {
  constructor(host, { onPocketClick } = {}) {
    this.host = host;
    this.onPocketClick = onPocketClick;
    this.order = [];          // numbers in list order (from API)
    this.index = new Map();   // number -> position in list order
    this.groups = new Map();  // number -> <g> of that pocket
    this.R = 0;               // current rotor rotation (deg, clockwise)
    this.ballAngle = 0;       // ball world angle (deg, clockwise from top)
    this.ballR = R_BALL_TRACK;
    this.ballVisible = false;
    this.animating = false;
    this.marker = null;
    this.lastResult = null;
    this.#buildStatic();
  }

  get theta() { return 360 / this.order.length; }

  #buildStatic() {
    const root = svg('svg', {
      viewBox: '-260 -268 520 528', class: 'wheel-svg', role: 'img',
      'aria-label': 'Roulette wheel',
    });
    const defs = svg('defs', {}, root);
    defs.innerHTML = `
      <radialGradient id="wg-wood" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stop-color="#5a3620"/><stop offset="70%" stop-color="#3a2213"/><stop offset="100%" stop-color="#22140b"/>
      </radialGradient>
      <linearGradient id="wg-brass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f3dc8c"/><stop offset="35%" stop-color="#c9a13b"/>
        <stop offset="65%" stop-color="#8a6a1f"/><stop offset="100%" stop-color="#e6c766"/>
      </linearGradient>
      <radialGradient id="wg-track" cx="50%" cy="50%" r="50%">
        <stop offset="80%" stop-color="#1b120b"/><stop offset="92%" stop-color="#2b1d12"/><stop offset="100%" stop-color="#140d08"/>
      </radialGradient>
      <radialGradient id="wg-cone" cx="45%" cy="40%" r="65%">
        <stop offset="0%" stop-color="#6b4325"/><stop offset="60%" stop-color="#40261400"/><stop offset="100%" stop-color="#2a180c"/>
      </radialGradient>
      <radialGradient id="wg-ball" cx="35%" cy="30%" r="70%">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#f1e9d6"/><stop offset="100%" stop-color="#a99c80"/>
      </radialGradient>
      <radialGradient id="wg-ball-rim" cx="50%" cy="50%" r="50%">
        <stop offset="70%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#3b3222" stop-opacity="0.45"/>
      </radialGradient>
      <filter id="wg-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
      <filter id="wg-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.55"/>
      </filter>`;

    // Static bowl: wooden rim, brass ring, ball track.
    svg('circle', { r: R_RIM, fill: 'url(#wg-wood)', filter: 'url(#wg-shadow)' }, root);
    svg('circle', { r: R_RIM - 3, fill: 'none', stroke: 'url(#wg-brass)', 'stroke-width': 5 }, root);
    svg('circle', { r: (R_TRACK_OUT + R_TRACK_IN) / 2, fill: 'none', stroke: 'url(#wg-track)', 'stroke-width': R_TRACK_OUT - R_TRACK_IN }, root);
    svg('circle', { r: R_TRACK_OUT, fill: 'none', stroke: '#c9a13b', 'stroke-opacity': 0.55, 'stroke-width': 1.2 }, root);
    // Deflector diamonds on the track (decorative).
    for (let k = 0; k < 8; k++) {
      const a = k * 45 + 22.5;
      const [x, y] = polar(R_TRACK_IN + 9, a);
      svg('rect', {
        x: -4, y: -7, width: 8, height: 14, rx: 1.5, fill: 'url(#wg-brass)',
        transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a})`,
      }, root);
    }

    // Rotor (rotates).
    this.rotor = svg('g', { class: 'rotor' }, root);
    this.pocketLayer = svg('g', {}, this.rotor);
    this.coneLayer = svg('g', { 'pointer-events': 'none' }, this.rotor);

    // Ball (world layer, above rotor). Light comes from the top-left of the table,
    // so highlight and shadow stay fixed in world space while the ball moves.
    this.trail = svg('path', { class: 'ball-trail', fill: 'none', stroke: '#f4ecd8', 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0 }, root);
    this.ball = svg('g', { class: 'ball', opacity: 0 }, root);
    svg('ellipse', { rx: 8.6, ry: 7.4, fill: '#000', opacity: 0.5, cx: 2.2, cy: 3.2, filter: 'url(#wg-blur)' }, this.ball);
    svg('circle', { r: 7.5, fill: 'url(#wg-ball)', stroke: '#8d826b', 'stroke-width': 0.5 }, this.ball);
    svg('circle', { r: 7.5, fill: 'url(#wg-ball-rim)' }, this.ball);
    svg('ellipse', { rx: 2.6, ry: 1.9, cx: -2.6, cy: -3, fill: '#fff', opacity: 0.95, transform: 'rotate(-35 -2.6 -3)' }, this.ball);
    svg('circle', { r: 0.9, cx: 2.8, cy: 3.4, fill: '#fff', opacity: 0.35 }, this.ball);

    // Result reveal (HTML overlay over the cone).
    this.reveal = document.createElement('div');
    this.reveal.className = 'wheel-reveal';
    this.reveal.hidden = true;
    this.reveal.setAttribute('aria-hidden', 'true');
    this.reveal.innerHTML = '<span class="wr-number"></span><span class="wr-color"></span>';

    // Fixed marker at the top.
    const marker = svg('g', { class: 'wheel-marker', 'aria-hidden': 'true' }, root);
    svg('path', { d: 'M-13 -266 L13 -266 L0 -236 Z', fill: 'url(#wg-brass)', stroke: '#3a2a08', 'stroke-width': 1.2 }, marker);
    svg('circle', { cx: 0, cy: -258, r: 3.2, fill: '#f4ecd8' }, marker);

    this.svg = root;
    this.host.appendChild(root);
    this.host.appendChild(this.reveal);
  }

  /** (Re)builds pockets when the API order changes; otherwise only updates classes. */
  render(wheel) {
    const order = wheel.pockets.map((p) => p.number);
    if (order.join(',') !== this.order.join(',')) this.#buildPockets(wheel.pockets);
    this.marker = wheel.marker;
    for (const [n, g] of this.groups) g.classList.toggle('at-marker', n === wheel.marker);
    if (!this.animating) this.#settleTo(wheel.marker);
    this.#updateLabel();
  }

  #buildPockets(pockets) {
    this.pocketLayer.replaceChildren();
    this.coneLayer.replaceChildren();
    this.groups.clear();
    this.index.clear();
    this.order = pockets.map((p) => p.number);
    const th = this.theta;

    pockets.forEach((p, i) => {
      this.index.set(p.number, i);
      const a = i * th;
      const g = svg('g', { class: `pocket pocket-${p.color.toLowerCase()}`, 'data-number': p.number }, this.pocketLayer);
      this.groups.set(p.number, g);
      svg('path', { class: 'pocket-cup', d: sectorPath(R_CUP_IN, R_BAND_IN, a - th / 2, a + th / 2) }, g);
      svg('path', { class: 'pocket-band', d: sectorPath(R_BAND_IN, R_BAND_OUT, a - th / 2, a + th / 2) }, g);
      svg('path', { class: 'pocket-cover', d: sectorPath(R_BAND_OUT - 1, R_BAND_OUT + 4, a - th / 2 + 0.6, a + th / 2 - 0.6) }, g);
      svg('path', { class: 'pocket-ring', d: sectorPath(R_CUP_IN + 1, R_BAND_OUT - 1, a - th / 2 + 0.4, a + th / 2 - 0.4) }, g);
      const t = svg('text', {
        class: 'pocket-num', x: 0, y: -(R_BAND_IN + R_BAND_OUT) / 2,
        transform: `rotate(${a})`, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, g);
      t.textContent = p.number;
      const title = svg('title', {}, g);
      title.textContent = `${p.number} ${colorName(p.color)}`;
      g.addEventListener('click', (e) => this.onPocketClick?.(p.number, e));
    });

    // Brass frets between pockets.
    const frets = svg('g', { class: 'frets' }, this.coneLayer);
    pockets.forEach((_, i) => {
      const a = i * th - th / 2;
      const [x1, y1] = polar(R_CUP_IN, a);
      const [x2, y2] = polar(R_BAND_OUT, a);
      svg('line', { x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2) }, frets);
    });
    svg('circle', { r: R_BAND_OUT, fill: 'none', stroke: 'url(#wg-brass)', 'stroke-width': 2 }, this.coneLayer);
    svg('circle', { r: R_BAND_IN, fill: 'none', stroke: 'url(#wg-brass)', 'stroke-width': 1.2, 'stroke-opacity': 0.8 }, this.coneLayer);

    // Cone + turret.
    svg('circle', { r: R_CUP_IN, fill: 'url(#wg-wood)', stroke: 'url(#wg-brass)', 'stroke-width': 3 }, this.coneLayer);
    svg('circle', { r: R_CUP_IN - 4, fill: 'url(#wg-cone)' }, this.coneLayer);
    for (let k = 0; k < 4; k++) {
      svg('path', {
        d: 'M0 -102 L9 -34 L0 -26 L-9 -34 Z', fill: 'url(#wg-brass)', stroke: '#5c4512', 'stroke-width': 0.8,
        transform: `rotate(${k * 90})`,
      }, this.coneLayer);
    }
    svg('circle', { r: 30, fill: 'url(#wg-brass)', stroke: '#5c4512', 'stroke-width': 1 }, this.coneLayer);
    svg('circle', { r: 18, fill: '#2a1a0d', stroke: 'url(#wg-brass)', 'stroke-width': 2 }, this.coneLayer);
    svg('circle', { r: 7, fill: 'url(#wg-brass)' }, this.coneLayer);
  }

  #applyTransforms(speed = 0) {
    this.rotor.setAttribute('transform', `rotate(${this.R.toFixed(3)})`);
    const [x, y] = polar(this.ballR, this.ballAngle);
    this.ball.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    this.ball.setAttribute('opacity', this.ballVisible ? 1 : 0);
    // Trail behind the ball (only when it moves fast).
    const len = Math.min(70, Math.abs(speed) * 0.045);
    if (this.ballVisible && len > 1.5) {
      const dir = speed < 0 ? 1 : -1; // behind = opposite to motion
      const a1 = this.ballAngle;
      const a2 = this.ballAngle + dir * len;
      this.trail.setAttribute('d', arcPath(this.ballR, Math.min(a1, a2), Math.max(a1, a2)));
      this.trail.setAttribute('stroke-opacity', Math.min(0.42, Math.abs(speed) / 2600).toFixed(3));
      this.trail.setAttribute('opacity', 1);
    } else {
      this.trail.setAttribute('opacity', 0);
    }
  }

  /** Angle the rotor must have so that `number` sits under the top marker. */
  #angleFor(number) {
    return -this.index.get(number) * this.theta;
  }

  #settleTo(number) {
    if (!this.index.has(number)) return;
    const target = this.#angleFor(number);
    const delta = mod(target - this.R, 360); // always clockwise
    if (delta < 0.01 || delta > 359.99) { this.#applyTransforms(); return; }
    const R0 = this.R;
    const first = !this.settledOnce;
    this.settledOnce = true;
    tween(first ? 0 : 900, (t) => {
      this.R = R0 + delta * easeOutCubic(t);
      this.#applyTransforms();
    });
  }

  setCovered(numbers) {
    const set = new Set(numbers);
    for (const [n, g] of this.groups) g.classList.toggle('covered', set.has(n));
  }

  setSelected(number) {
    for (const [n, g] of this.groups) g.classList.toggle('selected', n === number);
  }

  setResult(number) {
    this.lastResult = number;
    for (const [n, g] of this.groups) g.classList.toggle('is-result', n === number);
    // Draw the winning pocket last so its glow is not covered by its neighbours.
    const g = this.groups.get(number);
    if (g) this.pocketLayer.appendChild(g);
    this.#updateLabel();
  }

  hideBall() {
    this.ballVisible = false;
    this.setResult(null);
    this.hideReveal();
    this.#applyTransforms();
  }

  #updateLabel() {
    const parts = [`Roulette wheel. Marker on ${this.marker ?? 0}.`];
    if (this.lastResult !== null && this.lastResult !== undefined) parts.push(`Ball on ${this.lastResult}.`);
    this.svg.setAttribute('aria-label', parts.join(' '));
  }

  /** Large chip-style reveal of the result in the centre of the wheel. */
  showReveal(result) {
    const c = result.color.toLowerCase();
    this.reveal.className = `wheel-reveal chip-reveal-${c} show`;
    this.reveal.querySelector('.wr-number').textContent = result.number;
    this.reveal.querySelector('.wr-color').textContent = colorName(result.color);
    this.reveal.hidden = false;
  }

  hideReveal() {
    this.reveal.classList.remove('show');
    this.reveal.hidden = true;
  }

  /**
   * Animates a SpinOutcome.
   *  - rotor: decelerates clockwise to the angle that puts marker_after under the marker;
   *  - ball: rolls counter-clockwise on the outer track for several laps, leaves the track,
   *    rattles over the deflectors, spirals across the frets, bounces between two adjacent
   *    pockets and comes to rest inside result.number, then rides with the rotor.
   * The ball is modelled by its angle RELATIVE to the rotor (rho), so once it is in the
   * pocket it rotates together with the wheel and both end exactly on the API values.
   */
  async spin(outcome, token = {}) {
    const markerAfter = outcome.marker_after;
    const resultNumber = outcome.result.number;
    if (!this.index.has(markerAfter) || !this.index.has(resultNumber)) return;

    this.animating = true;
    this.setResult(null);
    this.hideReveal();
    const th = this.theta;
    const aRes = this.index.get(resultNumber) * th;            // result pocket, rotor frame
    const R0 = this.R;
    const Rend = R0 + 3 * 360 + mod(this.#angleFor(markerAfter) - R0, 360);
    const B0 = this.ballVisible ? this.ballAngle : -8;
    const rho0 = B0 - R0;
    // First touch-down is one pocket clockwise of the result; the bounce carries it home.
    const rhoLand = rho0 - 8 * 360 - mod(rho0 - (aRes + th), 360);
    const r0 = this.ballVisible ? this.ballR : R_BALL_TRACK;
    this.ballVisible = true;

    let lastB = B0;
    let lastT = 0;
    const frame = (t) => {
      const R = R0 + (Rend - R0) * wheelEase(t);
      let rho;
      let r;
      if (t < T_LAND) {
        rho = rho0 + (rhoLand - rho0) * ballEase(t / T_LAND);
        r = rollingRadius(t, r0, rho + R, rho, th);
      } else if (t < T_SETTLE) {
        const [off, lift] = bounce((t - T_LAND) / (T_SETTLE - T_LAND));
        rho = aRes + off * th;
        r = R_BALL_POCKET + lift;
      } else {
        rho = aRes;
        r = R_BALL_POCKET;
      }
      this.R = R;
      this.ballAngle = rho + R;
      this.ballR = r;
      // Motion trail proportional to the ball's world angular speed.
      const dt = (t - lastT) * SPIN_MS;
      const speed = dt > 0 ? ((this.ballAngle - lastB) / dt) * 1000 : 0; // deg/s, negative = CCW
      lastB = this.ballAngle;
      lastT = t;
      this.#applyTransforms(t < 1 ? speed : 0);
    };

    await tween(prefersReducedMotion() ? 0 : SPIN_MS, frame, token);

    this.R = mod(Rend, 360);
    this.ballAngle = mod(aRes + Rend, 360);
    this.ballR = R_BALL_POCKET;
    this.#applyTransforms(0);
    this.animating = false;
    this.marker = markerAfter;
    for (const [n, g] of this.groups) g.classList.toggle('at-marker', n === markerAfter);
    this.setResult(resultNumber);
    this.showReveal(outcome.result);
  }
}

// Phase boundaries as fractions of SPIN_MS.
const T_LIFT = 0.04;    // ball lifted from the pocket onto the track
const T_DROP = 0.46;    // ball leaves the outer track
const T_CONE = 0.6;     // ball has crossed the deflectors and reaches the frets
const T_LAND = 0.76;    // first touch-down in a pocket
const T_SETTLE = 0.9;   // bouncing finished; the ball rides with the rotor
const DIAMONDS = Array.from({ length: 8 }, (_, k) => k * 45 + 22.5);

/** Rotor: smooth deceleration that ends at zero speed. */
const wheelEase = (t) => 1 - (1 - t) ** 3;
/** Ball relative to rotor: strong deceleration, keeping a little speed for the first bounce. */
const ballEase = (s) => 0.93 * (1 - (1 - s) ** 3) + 0.07 * s;

function rollingRadius(t, r0, worldAngle, rho, th) {
  if (t < T_LIFT) return r0 + (R_BALL_TRACK - r0) * easeOutCubic(t / T_LIFT);
  if (t < T_DROP) return R_BALL_TRACK;
  if (t < T_CONE) {
    // Slides down the track edge and rattles over the deflector diamonds.
    const v = (t - T_DROP) / (T_CONE - T_DROP);
    const base = R_BALL_TRACK - (R_BALL_TRACK - (R_BAND_OUT - 2)) * easeInQuad(v);
    let bump = 0;
    for (const d of DIAMONDS) {
      const delta = mod(worldAngle - d + 180, 360) - 180;
      bump = Math.max(bump, 7 * Math.exp(-((delta / 3.2) ** 2)));
    }
    return base + bump * Math.sin(Math.PI * v);
  }
  // Spirals across the number band into the pockets, ticking over each fret.
  const v = (t - T_CONE) / (T_LAND - T_CONE);
  const base = (R_BAND_OUT - 2) - ((R_BAND_OUT - 2) - (R_BALL_POCKET + 4)) * easeInQuad(v);
  const fret = 1.6 * Math.abs(Math.sin((Math.PI * (rho + th / 2)) / th));
  return base + fret * (1 - v);
}

/** Two hops between adjacent pockets with a small overshoot. Returns [offsetInPockets, lift]. */
function bounce(u) {
  const base = 4 * (1 - u);
  if (u < 0.5) {
    const v = u / 0.5;
    return [1 + (-0.32 - 1) * easeInOutSine(v), base + 10 * Math.sin(Math.PI * v)];
  }
  if (u < 0.8) {
    const v = (u - 0.5) / 0.3;
    return [-0.32 + 0.44 * easeInOutSine(v), base + 4 * Math.sin(Math.PI * v)];
  }
  const v = (u - 0.8) / 0.2;
  return [0.12 * (1 - easeOutCubic(v)), base];
}
