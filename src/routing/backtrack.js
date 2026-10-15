import { distKm } from '../core/geo.js';

// Entfernt Hin-und-zurück-Stiche (Sackgassen-Spikes), die entstehen, wenn ein
// Wegpunkt am Ende einer Sackgasse liegt.
//  • Stiche < 1,8 km: immer entfernen.
//  • längere Stiche (bis 40 % der Zieldistanz, max. 15 km): nur, wenn die
//    eingeschlossene Fläche winzig ist (mittlere Breite < 120 m) – also ein
//    echter Hin-und-zurück-Weg, keine legitime Teilschleife.
// Punkte im Umkreis von 150 m um ein Zwischenziel sind geschützt.
// Es werden nur Punkte gelöscht, nie verändert (wichtig für die Belag-Zuordnung).

const SNAP_KM = 0.07;
const MAX_SPIKE_SHORT = 1.8;
const SLIVER_WIDTH_KM = 0.12;
const PROTECT_KM = 0.15;

function sliceArea(pts, i, j) {
  const la0 = pts[i][1] * Math.PI / 180;
  const kx = 111.32 * Math.cos(la0), ky = 111.32;
  let a = 0;
  for (let k = i; k <= j; k++) {
    const p = pts[k], q = pts[k === j ? i : k + 1];
    a += (p[0] * kx) * (q[1] * ky) - (q[0] * kx) * (p[1] * ky);
  }
  return Math.abs(a) / 2;
}

export function removeBacktracks(coords, protect = [], targetKm = 0) {
  const maxSpikeLong = Math.max(MAX_SPIKE_SHORT, Math.min(targetKm * 0.4, 15));
  const isProtected = (p) => protect.some((v) => distKm(p, v) < PROTECT_KM);
  let pts = coords.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const cum = new Array(pts.length);
    cum[0] = 0;
    for (let k = 1; k < pts.length; k++) cum[k] = cum[k - 1] + distKm(pts[k - 1], pts[k]);
    outer:
    for (let i = 0; i < pts.length - 3; i++) {
      for (let j = i + 3; j < pts.length; j++) {
        const len = cum[j] - cum[i];
        if (len > maxSpikeLong) break;
        if (distKm(pts[i], pts[j]) >= SNAP_KM) continue;
        if (len > MAX_SPIKE_SHORT && sliceArea(pts, i, j) / (len / 2) >= SLIVER_WIDTH_KM) continue;
        let blocked = false;
        if (protect.length) {
          for (let k = i + 1; k <= j; k++) if (isProtected(pts[k])) { blocked = true; break; }
        }
        if (!blocked) {
          pts.splice(i + 1, j - i);
          changed = true;
          break outer;
        }
      }
    }
  }
  return pts;
}
