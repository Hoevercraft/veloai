import { distKm, bearing, angleDiff, pointAtKm } from '../core/geo.js';

// Bewertet eine fertige Kandidaten-Route mit 0–1 je Kriterium und einem
// gewichteten Gesamtwert. Die Gewichte unterscheiden sich je Fahrradtyp:
// bei Hardcore zählt der Belag am meisten, beim Rennrad Belag und Distanz gleich.

export const WEIGHTS = {
  road: { distance: 0.35, surface: 0.35, overlap: 0.2, direction: 0.12 },
  gravel: { distance: 0.35, surface: 0.3, overlap: 0.25, direction: 0.12 },
  hardcore: { distance: 0.25, surface: 0.45, overlap: 0.2, direction: 0.12 },
};

/** Distanztreue: 0 % Abweichung → 1, 12 % → 0,37, 25 % → ~0,01 */
export function distanceScore(actualKm, targetKm) {
  const dev = Math.abs(actualKm - targetKm) / targetKm;
  return Math.exp(-((dev / 0.12) ** 2));
}

/** Belag-Eignung je Fahrradtyp (Eingabe: analyzeSurface-Ergebnis). */
export function surfaceScore(s, bike) {
  if (!s || s.totalKm === 0) return 0.5; // keine Daten → neutral
  if (bike === 'road') {
    let v = 1 - Math.min(1, s.roadRiskPct / 20);
    if (s.hasOffroadSegment) v *= 0.5;
    return v;
  }
  if (bike === 'hardcore') {
    const offroad = Math.pow(s.unpavedShare, 1.5);
    const majorPenalty = 1 - Math.min(1, s.majorRoadShare * 4);
    return offroad * majorPenalty;
  }
  // Gravel: ab 50 % unbefestigt volle Punktzahl, große Straßen bestrafen
  const mix = Math.min(1, s.unpavedShare / 0.5);
  return mix * (1 - Math.min(1, s.majorRoadShare * 2.5));
}

/**
 * Anteil der Strecke, der doppelt befahren wird. Die Route wird alle ~25 m
 * abgetastet und in ein ~40-m-Raster einsortiert. Eine Zelle, die nach
 * mindestens 400 m erneut besucht wird, zählt als Doppelbefahrung.
 */
export function overlapShare(coords) {
  if (coords.length < 2) return 0;
  const cell = 0.0004; // ≈ 40 m in Breite, in Länge etwas weniger – reicht
  const lastVisit = new Map();
  let travelled = 0, repeated = 0;
  const STEP = 0.025;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const seg = distKm(a, b);
    const steps = Math.max(1, Math.round(seg / STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const lon = a[0] + (b[0] - a[0]) * t, lat = a[1] + (b[1] - a[1]) * t;
      const key = Math.round(lon / cell) + ':' + Math.round(lat / cell);
      const pos = travelled + seg * t;
      const prev = lastVisit.get(key);
      if (prev != null && pos - prev > 0.4) repeated += seg / steps;
      lastVisit.set(key, pos);
    }
    travelled += seg;
  }
  return travelled > 0 ? repeated / travelled : 0;
}

export function overlapScore(share) {
  return Math.max(0, 1 - share * 4); // 25 % Doppelbefahrung → 0
}

/** Startrichtung: Peilung vom Start zum Punkt nach min(5 km, 20 %) der Runde. */
export function startBearing(coords, totalKm) {
  const probe = pointAtKm(coords, Math.min(5, totalKm * 0.2));
  return bearing(coords[0], probe);
}

export function directionScore(coords, totalKm, heading) {
  if (heading == null) return null;
  const diff = angleDiff(startBearing(coords, totalKm), heading);
  return (1 + Math.cos(diff * Math.PI / 180)) / 2; // 0° → 1, 90° → 0,5, 180° → 0
}

/**
 * Gesamtbewertung. Liefert { total, parts } mit Teilwerten 0–1.
 * Ohne Kompassrichtung fällt das Richtungskriterium weg und die übrigen
 * Gewichte werden hochskaliert.
 */
export function scoreRoute({ coords, actualKm, targetKm, surface, bike, heading }) {
  const w = WEIGHTS[bike] || WEIGHTS.gravel;
  const ov = overlapShare(coords);
  const parts = {
    distance: distanceScore(actualKm, targetKm),
    surface: surfaceScore(surface, bike),
    overlap: overlapScore(ov),
    direction: directionScore(coords, actualKm, heading),
  };
  let sum = 0, wsum = 0;
  for (const k of Object.keys(w)) {
    if (parts[k] == null) continue;
    sum += parts[k] * w[k];
    wsum += w[k];
  }
  return { total: wsum ? sum / wsum : 0, parts, overlapShare: ov };
}
