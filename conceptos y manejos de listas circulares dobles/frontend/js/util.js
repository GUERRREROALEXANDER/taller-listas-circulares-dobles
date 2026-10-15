// Small DOM / SVG / animation helpers shared by the views. No game logic here.

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Angle in degrees, measured clockwise from 12 o'clock. Returns SVG coordinates. */
export function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** Annular sector path between radii r1 < r2 and angles a1 < a2 (degrees, clockwise from top). */
export function sectorPath(r1, r2, a1, a2) {
  const [x1, y1] = polar(r2, a1);
  const [x2, y2] = polar(r2, a2);
  const [x3, y3] = polar(r1, a2);
  const [x4, y4] = polar(r1, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r2} ${r2} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} `
    + `L${x3.toFixed(2)} ${y3.toFixed(2)} A${r1} ${r1} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/** Arc path on radius r from angle a1 to a2 (clockwise if a2 > a1). */
export function arcPath(r, a1, a2) {
  const [x1, y1] = polar(r, a1);
  const [x2, y2] = polar(r, a2);
  const sweep = a2 > a1 ? 1 : 0;
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export const mod = (a, m) => ((a % m) + m) % m;

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => motionQuery.matches;

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeInQuad = (t) => t * t;

/**
 * requestAnimationFrame tween. `frame(t)` receives linear progress 0..1.
 * Resolves when done or when `token.cancelled` becomes true (after a final frame(1)).
 */
export function tween(duration, frame, token = {}) {
  return new Promise((resolve) => {
    if (duration <= 0 || prefersReducedMotion()) {
      frame(1);
      resolve();
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      if (token.cancelled) {
        frame(1);
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      frame(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export function wait(ms, token = {}) {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      if (token.cancelled || performance.now() - t0 >= ms) resolve();
      else setTimeout(check, Math.min(40, ms));
    };
    check();
  });
}

const COLOR_NAME = { RED: 'Red', BLACK: 'Black', GREEN: 'Green' };
export const colorName = (c) => COLOR_NAME[c] ?? c;
export const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
export const signed = (n) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));

// ---------- Toasts (never alert()) ----------
export function toast(message, kind = 'info', ms = 4200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-dot', 'aria-hidden': 'true' }),
    h('p', { text: message }),
    h('button', {
      type: 'button', class: 'toast-close', 'aria-label': 'Dismiss notification',
      onclick: () => dismiss(),
    }, '×'));
  host.appendChild(el);
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 220);
  };
  setTimeout(dismiss, ms);
  while (host.children.length > 4) host.firstElementChild.remove();
}
