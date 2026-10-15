import { distKm, bearing, angleDiff, destination, seededRandom } from '../core/geo.js';

// Erzeugt Kandidaten-Layouts für Rundkurse.
//
// Idee: Die Wegpunkte liegen auf einem Kreis mit Radius r um einen Mittelpunkt C.
// C ist vom Start um c·r versetzt (c = 1 → Start liegt auf dem Kreis, die Runde
// liegt komplett auf einer Seite; c < 1 → Start liegt im Kreis). Der Radius
// wird so skaliert, dass der Polygonumfang × Umwegfaktor der Zieldistanz entspricht.
// Anschließend wird das Layout um den Start gedreht, sodass die Runde in die
// gewünschte Startrichtung (Kompass) losfährt – oder zufällig, wenn keine gewählt ist.

/** Umwegfaktor: echte Wegstrecke / Luftlinien-Polygon. */
export const DETOUR = { road: 1.25, gravel: 1.33, hardcore: 1.4 };

/** Wegpunktzahl skaliert mit der Distanz: 30 → 3 · 70 → 4 · 120 → 6 · 180 → 8 */
export function waypointCount(km) {
  return Math.min(8, Math.max(3, Math.round(km / 30) + 2));
}

// Layout in lokalen Einheiten (Start im Ursprung, Kreis-Radius 1), x = Ost, y = Nord.
// Liefert Punkte in Fahrreihenfolge (ohne Start).
function unitLayout(n, c, clockwise) {
  // Mittelpunkt liegt in Richtung Nord (0°) vom Start, Abstand c
  const cx = 0, cy = c;
  // Winkel des Starts relativ zum Mittelpunkt (Mathe-Winkel, 0 = Ost, gegen Uhrzeigersinn)
  const startAng = Math.atan2(0 - cy, 0 - cx);
  const pts = [];
  for (let k = 1; k <= n; k++) {
    const t = (k / (n + 1)) * 2 * Math.PI * (clockwise ? -1 : 1);
    pts.push([cx + Math.cos(startAng + t), cy + Math.sin(startAng + t)]);
  }
  return pts;
}

function unitPerimeter(pts) {
  const all = [[0, 0], ...pts, [0, 0]];
  let d = 0;
  for (let i = 1; i < all.length; i++) d += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  return d;
}

/** Lokale Einheit → geografischer Punkt: um `rot` Grad gedreht, skaliert mit rKm. */
function toGeo(start, p, rKm, rot) {
  const dist = Math.hypot(p[0], p[1]) * rKm;
  if (dist < 1e-6) return start.slice(0, 2);
  const brg = (Math.atan2(p[0], p[1]) * 180 / Math.PI + rot + 360) % 360; // atan2(x,y) → Kompasswinkel
  return destination(start, dist, brg);
}

/**
 * Erzeugt `count` unterschiedliche Layouts.
 * @returns [{ id, waypoints:[[lon,lat]], rKm, rotation, c, clockwise, scale }]
 */
export function generateLayouts({ start, distKm: target, bike, heading = null, vias = [], seed = 1, count = 6, scale = 1 }) {
  const rnd = seededRandom(seed);
  const n = Math.max(1, waypointCount(target) - vias.length);
  const detour = DETOUR[bike] || 1.3;
  const shapes = [
    { c: 1.0, clockwise: true },
    { c: 1.0, clockwise: false },
    { c: 0.8, clockwise: true },
    { c: 0.8, clockwise: false },
    { c: 0.65, clockwise: true },
    { c: 0.65, clockwise: false },
  ];
  const viaCentroidBrg = vias.length
    ? bearing(start, [vias.reduce((s, v) => s + v[0], 0) / vias.length, vias.reduce((s, v) => s + v[1], 0) / vias.length])
    : null;

  const out = [];
  for (let i = 0; i < count; i++) {
    const shape = shapes[i % shapes.length];
    const unit = unitLayout(n, shape.c, shape.clockwise);
    // Radius so wählen, dass Umfang × Umweg ≈ Ziel (leichte Streuung für Vielfalt)
    const jitterScale = 1 + (rnd() - 0.5) * 0.12;
    const rKm = (target / (detour * unitPerimeter(unit))) * scale * jitterScale;

    // Rotation bestimmen: Richtung vom Start zum Punkt nach ~15 % der Runde soll
    // der Kompassrichtung entsprechen. Ohne Kompass: zufällig bzw. Richtung der Zwischenziele.
    const firstUnit = unit[0];
    const firstBrgUnrotated = (Math.atan2(firstUnit[0], firstUnit[1]) * 180 / Math.PI + 360) % 360;
    let wantFirst;
    if (heading != null) wantFirst = heading + (rnd() - 0.5) * 30;
    else if (viaCentroidBrg != null) wantFirst = viaCentroidBrg + (shape.clockwise ? -40 : 40) + (rnd() - 0.5) * 40;
    else wantFirst = rnd() * 360;
    const rotation = (wantFirst - firstBrgUnrotated + 360) % 360;

    const generated = unit.map((p) => toGeo(start, p, rKm, rotation));
    out.push({
      id: `L${seed}-${i}-${scale.toFixed(2)}`,
      generated,
      rKm,
      rotation,
      c: shape.c,
      clockwise: shape.clockwise,
      scale,
      center: toGeo(start, [0, shape.c], rKm, rotation),
    });
  }
  return out;
}

/**
 * Verschiebt jeden Ideal-Wegpunkt auf den besten POI-Kandidaten in der Nähe
 * (Qualität × Nähe). Ohne passenden Kandidaten bleibt der Idealpunkt –
 * BRouter rastet ihn auf den nächsten Weg ein.
 */
export function snapToCandidates(points, pool, rKm, avoid = []) {
  const searchKm = Math.max(1.5, rKm * 0.35);
  const sigma = Math.max(1, rKm * 0.25);
  const taken = [...avoid];
  return points.map((ideal) => {
    let best = null, bestScore = -1;
    for (const cand of pool) {
      const d = distKm(ideal, cand.coord);
      if (d > searchKm) continue;
      if (taken.some((t) => distKm(t, cand.coord) < 1.5)) continue;
      const s = cand.q * Math.exp(-((d / sigma) ** 2));
      if (s > bestScore) { bestScore = s; best = cand.coord; }
    }
    const chosen = best || ideal;
    taken.push(chosen);
    return chosen;
  });
}

/**
 * Fügt Zwischenziele in die Fahrreihenfolge ein: alle Punkte werden nach ihrem
 * Winkel um den Layout-Mittelpunkt sortiert, beginnend beim Start, in Fahrtrichtung.
 * Generierte Punkte, die zu nah an einem Zwischenziel liegen, entfallen.
 */
export function mergeVias(start, layout, generated, vias) {
  if (!vias.length) return generated;
  const keep = generated.filter((g) => !vias.some((v) => distKm(g, v) < 2));
  const all = [...keep, ...vias];
  const startAng = bearing(layout.center, start);
  const dir = layout.clockwise ? 1 : -1; // Kompasswinkel wächst im Uhrzeigersinn
  const rel = (p) => {
    const a = bearing(layout.center, p);
    return ((dir * (a - startAng)) % 360 + 360) % 360;
  };
  return all.sort((a, b) => rel(a) - rel(b));
}

/** Untere Distanz-Schranke einer Runde durch alle Zwischenziele (Luftlinie × 1,3). */
export function minLoopKmThroughVias(start, vias) {
  if (!vias.length) return 0;
  const sorted = vias.slice().sort((a, b) => bearing(start, a) - bearing(start, b));
  const loop = [start, ...sorted, start];
  let d = 0;
  for (let i = 1; i < loop.length; i++) d += distKm(loop[i - 1], loop[i]);
  return d * 1.3;
}

export { angleDiff };
