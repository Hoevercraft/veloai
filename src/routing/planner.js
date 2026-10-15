import { distKm, bearing, destination, lineKm } from '../core/geo.js';
import { generateLayouts, snapToCandidates, mergeVias, minLoopKmThroughVias } from './loopgen.js';
import { parseMessages, analyzeSurface, surfaceKeyMap, surfaceSegments, surfacePieces, breakdownFromPieces } from './surface.js';
import { removeBacktracks } from './backtrack.js';
import { scoreRoute } from './scoring.js';
import { mapLimit } from '../services/http.js';

// Rundkurs-Planer: mehrere Kandidaten parallel erzeugen, bewerten, bester gewinnt.
//
//  1. Wegpunkt-Pool aus OSM laden (einmal, gecacht)
//  2. Runde 1: 6 unterschiedliche Layouts (Form, Drehsinn, Radius) → je eine BRouter-Anfrage
//  3. Jede Route bereinigen (Stichstrecken), Belag analysieren, bewerten
//  4. Runde 2: die zwei besten Layouts mit korrigiertem Radius erneut rechnen,
//     falls die Distanz noch nicht passt
//  5. Ergebnis: beste Route + unterschiedliche Alternativen zum Durchblättern

export const PLANNER_DEFAULTS = {
  firstRound: 6,
  refineTop: 2,
  concurrency: 3,
  maxAlternatives: 5,
  similarity: 0.8,
};

/** Höhenmeter aus der Geometrie, mit 3-m-Hysterese gegen Messrauschen. */
export function ascentFromCoords(coords) {
  if (!coords.length || coords[0].length < 3) return 0;
  let up = 0, ref = coords[0][2];
  for (const c of coords) {
    const e = c[2];
    if (e - ref >= 3) { up += e - ref; ref = e; }
    else if (ref - e >= 3) ref = e;
  }
  return up;
}

function cellSet(coords) {
  const s = new Set();
  for (let i = 0; i < coords.length; i += 2) s.add(Math.round(coords[i][0] / 0.0008) + ':' + Math.round(coords[i][1] / 0.0008));
  return s;
}

function similarity(a, b) {
  let hit = 0;
  for (const k of a) if (b.has(k)) hit++;
  return a.size ? hit / a.size : 0;
}

function scaleFromStart(start, pts, k) {
  return pts.map((p) => destination(start, distKm(start, p) * k, bearing(start, p)));
}

/**
 * @param params { start:[lon,lat], distKm, bike, heading|null, hot, vias:[[lon,lat]], seed }
 * @param services { routing, pois }
 * @param onProgress (text) => void
 */
export async function planRoundTrip(params, services, onProgress = () => {}, opts = {}) {
  const o = { ...PLANNER_DEFAULTS, ...opts };
  const { start, bike, heading = null, hot = false, vias = [], seed = 1 } = params;
  const notes = [];

  let target = params.distKm;
  const minKm = minLoopKmThroughVias(start, vias);
  if (minKm > target) {
    target = Math.ceil(minKm / 5) * 5;
    notes.push(`Für die Zwischenziele ist die Zieldistanz zu kurz – die Route wird etwa ${target} km lang.`);
  }

  onProgress('Suche passende Wege in der Umgebung…');
  let pool = [];
  try {
    pool = await services.pois.candidates({ center: start, radiusKm: target * 0.35 + 3, bike, hot });
  } catch (e) {
    console.warn('Wegpunkt-Kandidaten nicht verfügbar:', e.message);
    notes.push('Wegsuche (Overpass) nicht erreichbar – Wegpunkte werden geometrisch gesetzt.');
  }

  const evaluate = async (layout, waypoints) => {
    const points = [start, ...waypoints, start];
    const raw = await services.routing.route(points, bike);
    const rows = parseMessages(raw.messages);
    const keyMap = surfaceKeyMap(rows, raw.coords);
    const coords = removeBacktracks(raw.coords, vias, target);
    const actualKm = lineKm(coords);
    const surface = analyzeSurface(rows, bike);
    const { segs, riskSegs } = surfaceSegments(coords, keyMap);
    const pieces = surfacePieces(coords, segs);
    const score = scoreRoute({ coords, actualKm, targetKm: target, surface, bike, heading });
    return {
      id: layout.id,
      layout,
      waypoints,
      coords,
      actualKm,
      ascentM: ascentFromCoords(coords) || raw.ascentM,
      durationS: raw.durationS,
      surface,
      segs,
      riskSegs,
      pieces,
      breakdown: breakdownFromPieces(pieces), // km je Belag auf der angezeigten Route
      score,
    };
  };

  const prepare = (layout) => {
    const snapped = snapToCandidates(layout.generated, pool, layout.rKm, vias);
    return mergeVias(start, layout, snapped, vias);
  };

  // ── Runde 1 ──
  const layouts = generateLayouts({ start, distKm: target, bike, heading, vias, seed, count: o.firstRound });
  let done = 0;
  onProgress(`Berechne ${layouts.length} Kandidaten…`);
  const r1 = await mapLimit(layouts, o.concurrency, async (l) => {
    const res = await evaluate(l, prepare(l));
    onProgress(`Kandidat ${++done}/${layouts.length} bewertet…`);
    return res;
  });
  const results = r1.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const errors = r1.filter((r) => r.status === 'rejected').map((r) => r.reason);

  // ── Runde 2: Distanz nachschärfen ──
  results.sort((a, b) => b.score.total - a.score.total);
  const refine = results.slice(0, o.refineTop).filter((r) => r.score.parts.distance < 0.9);
  if (refine.length) {
    onProgress('Feinabstimmung der Distanz…');
    const r2 = await mapLimit(refine, o.concurrency, async (r) => {
      const k = Math.min(1.6, Math.max(0.6, target / r.actualKm));
      const gen = scaleFromStart(start, r.layout.generated, k);
      const layout = { ...r.layout, id: r.layout.id + '-r', generated: gen, rKm: r.layout.rKm * k };
      return evaluate(layout, prepare(layout));
    });
    for (const r of r2) {
      if (r.status === 'fulfilled') results.push(r.value);
      else errors.push(r.reason);
    }
  }

  if (!results.length) {
    const msg = errors[0]?.message || 'Keine Route gefunden.';
    throw new Error(msg);
  }

  // ── Auswahl: bester zuerst, dann unterschiedliche Alternativen ──
  results.sort((a, b) => b.score.total - a.score.total);
  const accepted = [];
  for (const r of results) {
    const cells = cellSet(r.coords);
    if (accepted.some((a) => similarity(cells, a.cells) > o.similarity)) continue;
    accepted.push({ ...r, cells });
    if (accepted.length >= o.maxAlternatives) break;
  }
  const routes = accepted.map(({ cells, ...r }) => r);

  return { routes, targetKm: target, notes, poolSize: pool.length, tried: results.length + errors.length, failed: errors.length };
}
