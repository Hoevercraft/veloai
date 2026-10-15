import { cumulative } from '../core/geo.js';
import { SURFACE_COLORS, SURFACE_LABELS } from '../routing/surface.js';
import { BIKES } from '../routing/profiles.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`;
}

/** Interaktives Höhenprofil. onHover(coord|null, km, ele) */
export function renderElevation(container, infoEl, coords, color, onHover) {
  if (!coords.length || coords[0].length < 3) {
    container.innerHTML = '<p class="hint">Keine Höhendaten vorhanden.</p>';
    return;
  }
  const cum = cumulative(coords);
  const total = cum[cum.length - 1] || 1;
  const eles = coords.map((c) => c[2] || 0);
  const min = Math.min(...eles), max = Math.max(...eles), span = max - min || 1;
  const W = 300, H = 64, P = 2;
  const step = Math.max(1, Math.floor(coords.length / 600));
  let pts = '';
  for (let i = 0; i < coords.length; i += step) {
    const x = P + (cum[i] / total) * (W - 2 * P);
    const y = H - P - ((eles[i] - min) / span) * (H - 2 * P);
    pts += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Höhenprofil von ${Math.round(min)} bis ${Math.round(max)} Meter">
      <polygon points="${pts} ${W - P},${H - P} ${P},${H - P}" fill="${color}" fill-opacity=".18"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <line id="elevCursor" x1="-10" x2="-10" y1="0" y2="${H}" stroke="#1e2a2b" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="elev-scale"><span>${Math.round(min)} m</span><span>${total.toFixed(0)} km</span><span>${Math.round(max)} m</span></div>`;
  const cursor = container.querySelector('#elevCursor');
  const move = (clientX) => {
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const km = ratio * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < km) lo = m + 1; else hi = m; }
    const x = P + ratio * (W - 2 * P);
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
    infoEl.textContent = `${km.toFixed(1)} km, ${Math.round(coords[lo][2] || 0)} m`;
    onHover(coords[lo]);
  };
  const leave = () => {
    cursor.setAttribute('x1', -10); cursor.setAttribute('x2', -10);
    infoEl.textContent = '';
    onHover(null);
  };
  container.onpointermove = (e) => move(e.clientX);
  container.onpointerdown = (e) => move(e.clientX);
  container.onpointerleave = leave;
  container.onpointercancel = leave;
}

export function renderSurface(barEl, listEl, breakdown) {
  const entries = Object.entries(breakdown || {}).filter(([, km]) => km > 0.01).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, km]) => s + km, 0);
  if (!total) {
    barEl.innerHTML = '';
    listEl.innerHTML = '<li>Keine Belagdaten vorhanden.</li>';
    return;
  }
  barEl.innerHTML = entries.map(([k, km]) =>
    `<i style="width:${(km / total * 100).toFixed(1)}%;background:${SURFACE_COLORS[k] || SURFACE_COLORS.other}" title="${esc(SURFACE_LABELS[k] || k)}"></i>`).join('');
  listEl.innerHTML = entries.map(([k, km]) => `
    <li><i style="background:${SURFACE_COLORS[k] || SURFACE_COLORS.other}"></i>
      <span class="name">${esc(SURFACE_LABELS[k] || k)}</span>
      <span class="val">${Math.round(km / total * 100)} %, ${km.toFixed(1)} km</span></li>`).join('');
}

const SCORE_LABELS = { distance: 'Distanz passt', surface: 'Belag passt', overlap: 'Wenig doppelt', direction: 'Startrichtung' };

export function renderScores(el, parts) {
  el.innerHTML = Object.entries(SCORE_LABELS)
    .filter(([k]) => parts[k] != null)
    .map(([k, label]) => {
      const pct = Math.round(parts[k] * 100);
      return `<div class="score" data-testid="score-${k}">${label} <b>${pct} %</b><div class="score-bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('');
}

/** GPX-Datei aus einer Route erzeugen. */
export function buildGpx(route, { bike, hot, vias }) {
  const label = BIKES[bike]?.label || bike;
  const date = new Date().toISOString().slice(0, 10);
  const name = `veloai ${label} ${route.actualKm.toFixed(0)} km ${date}`;
  const wpts = vias.filter((v) => v.coord).map((v, i) =>
    `  <wpt lat="${v.coord[1].toFixed(7)}" lon="${v.coord[0].toFixed(7)}"><name>${esc(`Zwischenziel ${i + 1}: ${v.name}`)}</name></wpt>`).join('\n');
  const trkpts = route.coords.map((c) =>
    `      <trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">${c.length > 2 ? `<ele>${(+c[2]).toFixed(1)}</ele>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="veloai" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><desc>${esc(label + (hot ? ', schattige Route' : ''))}</desc><time>${new Date().toISOString()}</time></metadata>
${wpts ? wpts + '\n' : ''}  <trk>
    <name>${esc(name)}</name>
    <type>${BIKES[bike]?.gpxType || 'cycling'}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Eingabefeld mit Vorschlagsliste (Ortssuche). onPick({name, coord}) */
export function attachAutocomplete(input, box, { search, onPick, minChars = 3 }) {
  let timer = null, items = [], active = -1, seq = 0;
  const close = () => { box.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    box.innerHTML = items.map((it, i) =>
      `<button type="button" role="option" data-i="${i}" aria-selected="${i === active}">${esc(it.name)}</button>`).join('');
    box.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
  };
  const pick = (i) => { const it = items[i]; if (!it) return; close(); onPick(it); };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minChars) { items = []; close(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const res = await search(q);
        if (my !== seq) return;
        items = res; active = -1; render();
      } catch (e) {
        console.warn('Ortssuche fehlgeschlagen:', e.message);
      }
    }, 280);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' && items.length) { active = (active + 1) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!box.hidden && items.length) { pick(active >= 0 ? active : 0); return; }
      const q = input.value.trim();
      if (!q) return;
      try { const res = await search(q); if (res[0]) onPick(res[0]); else onPick(null); }
      catch { onPick(null); }
    }
  });
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) { e.preventDefault(); pick(+b.dataset.i); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  return { close };
}
