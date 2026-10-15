import { createState } from './app/state.js';
import { createMap } from './app/map.js';
import { createCompass, directionName } from './app/compass.js';
import { renderElevation, renderSurface, renderScores, buildGpx, attachAutocomplete, formatDuration, esc } from './app/widgets.js';
import { createServices } from './services/index.js';
import { planRoundTrip } from './routing/planner.js';
import { BIKES } from './routing/profiles.js';

// Einstiegspunkt: verbindet Zustand, Dienste, Karte und Bedienpanel.

const $ = (id) => document.getElementById(id);
const services = createServices();
const { state, load, save } = createState();
load();

const map = createMap($('map'), { onPickStart: (coord) => pickStartFromCoord(coord) });

// ── Hilfen ──
function show(el, text) {
  if (text) { el.textContent = text; el.hidden = false; } else { el.textContent = ''; el.hidden = true; }
}
function busy(on, text = '') {
  $('planBtn').disabled = on;
  $('spinner').hidden = !on;
  $('planLabel').textContent = on ? 'Plane…' : 'Route planen';
  $('status').textContent = text;
}
function accent() { return BIKES[state.bike].color; }

// ── Start ──
function setStart(coord, name, opts) {
  state.start = coord ? { coord, name } : null;
  map.setStart(coord, name, opts);
  map.setHeading(coord, state.heading, accent());
  show($('startName'), coord ? `Start: ${name}` : '');
  $('mapHint').hidden = !!coord;
  show($('startErr'), '');
  save();
}
async function pickStartFromCoord(coord) {
  const name = await services.geocoder.reverse(coord);
  $('startInput').value = name;
  setStart(coord, name);
}
attachAutocomplete($('startInput'), $('startSuggest'), {
  search: (q) => services.geocoder.search(q, state.start?.coord),
  onPick: (it) => {
    if (!it) { show($('startErr'), 'Ort nicht gefunden. Versuche es mit Ort und Straße.'); return; }
    $('startInput').value = it.name;
    setStart(it.coord, it.name);
  },
});
$('gpsBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { show($('startErr'), 'Dein Browser gibt keinen Standort frei.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => pickStartFromCoord([pos.coords.longitude, pos.coords.latitude]),
    () => show($('startErr'), 'Standort nicht verfügbar. Erlaube den Zugriff oder suche den Ort.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ── Radtyp ──
function setBike(bike) {
  state.bike = bike;
  document.body.dataset.bike = bike;
  document.querySelectorAll('.bike').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bike === bike)));
  map.setHeading(state.start?.coord, state.heading, accent());
  save();
}
document.querySelectorAll('.bike').forEach((b) => b.addEventListener('click', () => setBike(b.dataset.bike)));

// ── Distanz ──
function setDist(km) {
  state.distKm = km;
  $('distSlider').value = km;
  $('distNum').textContent = km;
  save();
}
$('distSlider').addEventListener('input', (e) => setDist(+e.target.value));

// ── Kompass ──
function applyHeading(h) {
  state.heading = h;
  $('headingLabel').textContent = h == null ? 'Egal' : directionName(h);
  $('headingHint').textContent = h == null
    ? 'Ziehe die Nadel oder tippe eine Richtung an.'
    : `Die Runde startet grob Richtung ${h}°. Tippe auf die Mitte für „egal“.`;
  $('headingClear').setAttribute('aria-pressed', String(h == null));
  map.setHeading(state.start?.coord, h, accent());
  save();
}
const compass = createCompass($('compass'), { onChange: applyHeading });
$('headingClear').addEventListener('click', () => compass.set(null));

// ── Zwischenziele ──
function renderVias() {
  const list = $('viaList');
  list.innerHTML = state.vias.map((v, i) => `
    <div class="via">
      <span class="via-n" aria-hidden="true">${i + 1}</span>
      <input class="input" type="search" autocomplete="off" data-testid="via-input-${i}" value="${esc(v.coord ? v.name : v.q)}"
             placeholder="Ort oder Adresse" aria-label="Zwischenziel ${i + 1}">
      <button class="icon-btn" type="button" data-remove="${i}" data-testid="via-remove-${i}" aria-label="Zwischenziel ${i + 1} entfernen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="suggest" role="listbox" hidden></div>
    </div>`).join('');
  list.querySelectorAll('.via').forEach((row, i) => {
    const input = row.querySelector('input');
    input.addEventListener('input', () => { state.vias[i].q = input.value; state.vias[i].coord = null; });
    attachAutocomplete(input, row.querySelector('.suggest'), {
      search: (q) => services.geocoder.search(q, state.start?.coord),
      onPick: (it) => {
        if (!it) { show($('viaErr'), `Zwischenziel ${i + 1} nicht gefunden.`); return; }
        state.vias[i] = { q: it.name, coord: it.coord, name: it.name };
        input.value = it.name;
        show($('viaErr'), '');
        map.setVias(state.vias);
        save();
      },
    });
  });
  $('viaAdd').hidden = state.vias.length >= 3;
  map.setVias(state.vias);
}
$('viaList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  state.vias.splice(+b.dataset.remove, 1);
  renderVias();
  save();
});
$('viaAdd').addEventListener('click', () => {
  if (state.vias.length >= 3) return;
  state.vias.push({ q: '', coord: null, name: '' });
  renderVias();
  $('viaList').querySelector(`[data-testid="via-input-${state.vias.length - 1}"]`)?.focus();
});

// Nicht ausgewählte Zwischenziel-Texte vor dem Planen auflösen
async function resolveVias() {
  for (let i = 0; i < state.vias.length; i++) {
    const v = state.vias[i];
    if (v.coord || !v.q.trim()) continue;
    const res = await services.geocoder.search(v.q.trim(), state.start?.coord, 1);
    if (!res[0]) throw new Error(`Zwischenziel ${i + 1} („${v.q}“) nicht gefunden. Wähle einen Vorschlag aus der Liste.`);
    state.vias[i] = { q: res[0].name, coord: res[0].coord, name: res[0].name };
  }
  state.vias = state.vias.filter((v) => v.coord);
  renderVias();
  return state.vias.map((v) => v.coord);
}

// ── Optionen ──
$('hotToggle').addEventListener('change', (e) => { state.hot = e.target.checked; save(); });
$('speedInput').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  state.speed = v > 0 ? v : 0;
  save();
  if (state.plan) showVariant(state.index, { fit: false });
});

// ── Kartenbedienung ──
document.querySelectorAll('[data-tile]').forEach((b) => b.addEventListener('click', () => {
  state.tile = b.dataset.tile;
  map.setTile(state.tile);
  document.querySelectorAll('[data-tile]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  save();
}));
document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
  state.colorBySurface = b.dataset.style === 'surface';
  document.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  save();
  if (state.plan) showVariant(state.index, { fit: false });
}));

// ── Planen ──
async function plan() {
  show($('planErr'), ''); show($('planNote'), ''); show($('viaErr'), '');
  if (!state.start) { show($('planErr'), 'Setze zuerst einen Startpunkt: Ort suchen, Standort nutzen oder auf die Karte tippen.'); return; }
  busy(true, 'Starte Planung…');
  try {
    let vias;
    try { vias = await resolveVias(); }
    catch (e) { show($('viaErr'), e.message); return; }
    const result = await planRoundTrip({
      start: state.start.coord,
      distKm: state.distKm,
      bike: state.bike,
      heading: state.heading,
      hot: state.hot,
      vias,
      seed: state.seed,
    }, services, (t) => { $('status').textContent = t; });
    state.plan = { ...result, bike: state.bike };
    show($('planNote'), result.notes.join(' '));
    showVariant(0);
    // Nur den Panel-Inhalt scrollen, nicht die ganze Seite
    const scroller = document.querySelector('.panel-scroll');
    scroller.scrollTo({ top: $('results').offsetTop - scroller.offsetTop - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('status').textContent = `${result.routes.length} Varianten aus ${result.tried} Kandidaten.`;
  } catch (e) {
    console.warn('Planung fehlgeschlagen:', e);
    show($('planErr'), `${e.message} Prüfe die Verbindung und versuche es erneut.`);
    $('status').textContent = '';
  } finally {
    $('spinner').hidden = true;
    $('planBtn').disabled = false;
    $('planLabel').textContent = 'Route planen';
  }
}
$('planBtn').addEventListener('click', plan);
$('rerollBtn').addEventListener('click', () => { state.seed = Math.floor(Math.random() * 1e6); plan(); });

function showVariant(i, { fit = true } = {}) {
  const { routes, bike } = state.plan;
  state.index = (i + routes.length) % routes.length;
  const r = routes[state.index];
  const color = BIKES[bike].color;
  map.showRoute(r, { bike, bySurface: state.colorBySurface, fit });
  $('styleSeg').hidden = !r.segs?.length;
  $('results').hidden = false;
  $('variantLabel').textContent = `Variante ${state.index + 1} von ${routes.length}`;
  $('variantScore').textContent = `Bewertung ${Math.round(r.score.total * 100)} von 100`;
  $('prevVariant').disabled = $('nextVariant').disabled = routes.length < 2;
  $('statDist').textContent = `${r.actualKm.toFixed(1)} km`;
  $('statAsc').textContent = r.ascentM ? `${Math.round(r.ascentM)} m` : '–';
  const speed = state.speed || BIKES[bike].speedKmh;
  $('statTime').textContent = formatDuration(r.actualKm / speed * 3600);
  show($('surfWarn'), r.surface.warning || '');
  renderScores($('scores'), r.score.parts);
  renderElevation($('elev'), $('elevInfo'), r.coords, color, (c) => (c ? map.showHover(c, color) : map.clearHover()));
  renderSurface($('surfBar'), $('surfList'), r.surface.breakdown);
  updateBrandSub();
}
$('prevVariant').addEventListener('click', () => showVariant(state.index - 1));
$('nextVariant').addEventListener('click', () => showVariant(state.index + 1));

$('gpxBtn').addEventListener('click', () => {
  if (!state.plan) return;
  const r = state.plan.routes[state.index];
  const gpx = buildGpx(r, { bike: state.plan.bike, hot: state.hot, vias: state.vias });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `veloai-${state.plan.bike}-${r.actualKm.toFixed(0)}km.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// ── Panel ein-/ausklappen ──
const BRAND_SUB = 'Rundkurse mit dem richtigen Belag';
function updateBrandSub() {
  const r = state.plan?.routes[state.index];
  const collapsed = document.body.classList.contains('panel-collapsed');
  $('brandSub').textContent = collapsed && r
    ? `${r.actualKm.toFixed(1).replace('.', ',')} km, ${Math.round(r.ascentM)} Hm`
    : BRAND_SUB;
}
function setPanelCollapsed(collapsed) {
  document.body.classList.toggle('panel-collapsed', collapsed);
  const t = $('panelToggle');
  t.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Panel ausklappen' : 'Panel einklappen';
  t.setAttribute('aria-label', label);
  t.title = label;
  updateBrandSub();
  requestAnimationFrame(() => map.resize({ refit: !!state.plan }));
}
$('panelToggle').addEventListener('click', () => setPanelCollapsed(!document.body.classList.contains('panel-collapsed')));

// ── Startzustand herstellen ──
$('mockBadge').hidden = !services.mock;
setBike(state.bike);
setDist(state.distKm);
compass.set(state.heading, false);
applyHeading(state.heading);
$('hotToggle').checked = state.hot;
if (state.speed) $('speedInput').value = state.speed;
map.setTile(state.tile);
document.querySelectorAll('[data-tile]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tile === state.tile)));
document.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.style === 'surface') === state.colorBySurface)));
if (state.start) { $('startInput').value = state.start.name; setStart(state.start.coord, state.start.name); }
renderVias();

// Für Tests und Fehlersuche
window.veloai = { state, services, plan, showVariant };
