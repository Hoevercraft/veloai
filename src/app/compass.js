// Kompass zur Wahl der Startrichtung (15°-Schritte).
// Ziehen oder Tippen setzt die Richtung, Tippen auf die Mitte setzt sie auf „egal“.
// Tastatur: Pfeiltasten ±15°, Entf/Esc = egal.

const NS = 'http://www.w3.org/2000/svg';
const NAMES = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];

export function directionName(deg) {
  return NAMES[Math.round(deg / 45) % 8];
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

function polar(r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

export function createCompass(svg, { onChange }) {
  const R = 86;
  el('circle', { class: 'ring', r: R }, svg);
  const sector = el('path', { class: 'sector' }, svg);
  for (let d = 0; d < 360; d += 15) {
    const major = d % 90 === 0, mid = d % 45 === 0;
    const [x1, y1] = polar(R, d), [x2, y2] = polar(R - (major ? 12 : mid ? 9 : 5), d);
    el('line', { class: 'tick' + (major ? ' major' : ''), x1, y1, x2, y2 }, svg);
  }
  for (const [label, d] of [['N', 0], ['O', 90], ['S', 180], ['W', 270]]) {
    const [x, y] = polar(R - 25, d);
    const t = el('text', { class: 'card' + (d === 0 ? ' n' : ''), x, y }, svg);
    t.textContent = label;
  }
  const needleGroup = el('g', { class: 'needle-group' }, svg);
  el('path', { class: 'needle', d: 'M0,-64 L9,0 L-9,0 Z' }, needleGroup);
  el('path', { class: 'needle-tail', d: 'M9,0 L0,22 L-9,0 Z' }, needleGroup);
  el('circle', { class: 'hub', r: 7 }, svg);

  let value = null;

  function render() {
    svg.dataset.off = value == null ? 'true' : 'false';
    if (value == null) {
      svg.setAttribute('aria-valuetext', 'egal');
      svg.removeAttribute('aria-valuenow');
      return;
    }
    needleGroup.setAttribute('transform', `rotate(${value})`);
    const [ax, ay] = polar(R, value - 30), [bx, by] = polar(R, value + 30);
    sector.setAttribute('d', `M0,0 L${ax},${ay} A${R},${R} 0 0 1 ${bx},${by} Z`);
    svg.setAttribute('aria-valuenow', value);
    svg.setAttribute('aria-valuetext', `${directionName(value)}, ${value} Grad`);
  }

  function set(v, emit = true) {
    value = v == null ? null : ((Math.round(v / 15) * 15) % 360 + 360) % 360;
    render();
    if (emit) onChange(value);
  }

  function fromPointer(ev) {
    const rect = svg.getBoundingClientRect();
    const x = ev.clientX - (rect.left + rect.width / 2);
    const y = ev.clientY - (rect.top + rect.height / 2);
    const r = Math.hypot(x, y) / (rect.width / 2) * 100;
    if (r < 18) return 'center';
    return (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  }

  let dragging = false, downAtCenter = false;
  svg.addEventListener('pointerdown', (ev) => {
    const v = fromPointer(ev);
    downAtCenter = v === 'center';
    if (!downAtCenter) { dragging = true; set(v); }
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const v = fromPointer(ev);
    if (v !== 'center' && Math.round(v / 15) * 15 % 360 !== value) set(v);
  });
  svg.addEventListener('pointerup', (ev) => {
    if (downAtCenter && fromPointer(ev) === 'center') set(null);
    dragging = false; downAtCenter = false;
  });
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { set((value ?? -15) + 15); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { set((value ?? 15) - 15); ev.preventDefault(); }
    else if (ev.key === 'Delete' || ev.key === 'Escape' || ev.key === 'Backspace') { set(null); ev.preventDefault(); }
  });

  render();
  return { set, get: () => value };
}
