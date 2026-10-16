import { distKm, cumulative } from '../core/geo.js';

// Erkennt Abstecher, die ein Wegpunkt erzwingt, und schlägt eine bessere Lage vor.
//
// Ein Wegpunkt muss exakt angefahren werden. Liegt er auf einer Nebenstraße,
// einem Stichweg oder Hofweg, verlässt die Route dafür die durchgehende Straße
// und kommt später zurück. Das Muster auf der gerouteten Spur:
//
//   durchgehend … A ──(Nebenweg)── W ──(Nebenweg)── B … durchgehend
//
// Ist der Weg A→W→B deutlich länger als die Luftlinie A–B, ist es ein Abstecher.
// Abhilfe: W auf A oder B setzen – beide liegen auf einer durchgehenden Straße,
// die BRouter ohnehin gewählt hat.

/** Straßenklassen, auf denen ein Wegpunkt je Radtyp gut liegt. */
export const THROUGH_ROADS = {
  road: new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'cycleway']),
  gravel: new Set(['track', 'unclassified', 'tertiary', 'tertiary_link', 'cycleway', 'path', 'bridleway']),
  hardcore: new Set(['track', 'path', 'bridleway']),
};

const MAX_SEARCH_KM = 3;   // so weit wird entlang der Spur nach der durchgehenden Straße gesucht
const MIN_DETOUR_KM = 0.3; // kürzere Nebenwege sind harmlos
const DETOUR_RATIO = 1.6;  // Weg A→W→B mindestens 1,6 × Luftlinie A–B (+200 m) = Abstecher

const ckey = (c) => Math.round(c[0] * 1e6) + ',' + Math.round(c[1] * 1e6);

/**
 * WayTags je Koordinate der Spur (BRouter-Nachrichtenzeile gilt bis zu ihrem Endpunkt).
 * rows: parseMessages-Ergebnis. → Array gleicher Länge wie coords.
 */
export function tagsPerCoord(rows, coords) {
  const n = coords.length;
  const out = new Array(n).fill(null);
  const index = new Map();
  for (let i = 0; i < n; i++) if (!index.has(ckey(coords[i]))) index.set(ckey(coords[i]), i);
  let prev = 0, first = true;
  for (const row of rows) {
    let end = index.get(row.lonM + ',' + row.latM);
    const from = first ? 0 : prev + 1; // Endpunkt der vorigen Zeile gehört zu ihr
    first = false;
    if (end == null || end < prev) {
      // Endpunkt nicht exakt in der Spur: nächstgelegenen Punkt ab prev suchen
      let best = prev, bd = Infinity;
      for (let i = prev; i < Math.min(n, prev + 500); i++) {
        const d = Math.abs(coords[i][0] * 1e6 - row.lonM) + Math.abs(coords[i][1] * 1e6 - row.latM);
        if (d < bd) { bd = d; best = i; }
      }
      end = best;
    }
    for (let i = from; i <= end && i < n; i++) out[i] = row.tags;
    prev = Math.max(prev, end);
  }
  const last = out[prev] || {};
  for (let i = 0; i < n; i++) if (!out[i]) out[i] = last;
  return out;
}

/** Index des Spurpunkts je Wegpunkt (in Fahrreihenfolge, monoton). */
export function waypointIndices(coords, waypoints) {
  const out = [];
  let from = 0;
  for (const w of waypoints) {
    let best = from, bd = Infinity;
    for (let i = from; i < coords.length; i++) {
      const d = distKm(coords[i], w);
      if (d < bd) { bd = d; best = i; }
      if (d < 0.002) break;
    }
    out.push(best);
    from = best;
  }
  return out;
}

/**
 * Findet Wegpunkte, die einen Abstecher erzwingen.
 * @returns [{ index, to:[lon,lat], detourKm }] – index = Position in `waypoints`
 */
export function findDetourFixes({ coords, tags, waypoints, bike, protect = [] }) {
  const through = THROUGH_ROADS[bike] || THROUGH_ROADS.gravel;
  const isThrough = (i) => through.has(tags[i]?.highway || '');
  const cum = cumulative(coords);
  const idx = waypointIndices(coords, waypoints);
  const fixes = [];
  waypoints.forEach((wp, k) => {
    if (protect.some((p) => p === wp || distKm(p, wp) < 0.05)) return; // Zwischenziele nie verschieben
    const w = idx[k];
    if (isThrough(w)) return;
    let a = w, b = w;
    while (a > 0 && !isThrough(a) && cum[w] - cum[a] < MAX_SEARCH_KM) a--;
    while (b < coords.length - 1 && !isThrough(b) && cum[b] - cum[w] < MAX_SEARCH_KM) b++;
    if (!isThrough(a) || !isThrough(b)) return; // keine durchgehende Straße in Reichweite
    const pathKm = cum[b] - cum[a];
    const gapKm = distKm(coords[a], coords[b]);
    if (pathKm < MIN_DETOUR_KM || pathKm < DETOUR_RATIO * gapKm + 0.2) return;
    const to = distKm(coords[a], wp) <= distKm(coords[b], wp) ? coords[a] : coords[b];
    fixes.push({ index: k, to: [to[0], to[1]], detourKm: pathKm - gapKm });
  });
  return fixes;
}
