// Reine Geo-Mathematik. Koordinaten immer als [lon, lat] (GeoJSON-Reihenfolge).

const R_EARTH_KM = 6371;
const RAD = Math.PI / 180;

/** Haversine-Distanz in km zwischen zwei [lon,lat]-Punkten. */
export function distKm(a, b) {
  const dLa = (b[1] - a[1]) * RAD;
  const dLo = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLa / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLo / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Peilung von a nach b in Grad (0 = Nord, 90 = Ost). */
export function bearing(a, b) {
  const dLo = (b[0] - a[0]) * RAD;
  const x = Math.sin(dLo) * Math.cos(b[1] * RAD);
  const y = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos(dLo);
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

/** Kleinster Winkelabstand zweier Peilungen (0–180). */
export function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Zielpunkt von `from` aus nach `km` in Richtung `deg`. */
export function destination(from, km, deg) {
  const dR = km / R_EARTH_KM, th = deg * RAD;
  const p1 = from[1] * RAD, l1 = from[0] * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dR) + Math.cos(p1) * Math.sin(dR) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dR) * Math.cos(p1), Math.cos(dR) - Math.sin(p1) * Math.sin(p2));
  return [l2 / RAD, p2 / RAD];
}

/** Gesamtlänge einer Koordinatenfolge in km. */
export function lineKm(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += distKm(coords[i - 1], coords[i]);
  return d;
}

/** Kumulierte Distanz (km) je Punkt. */
export function cumulative(coords) {
  const out = new Array(coords.length);
  out[0] = 0;
  for (let i = 1; i < coords.length; i++) out[i] = out[i - 1] + distKm(coords[i - 1], coords[i]);
  return out;
}

/** Punkt bei `km` entlang der Linie (erster Punkt, dessen kumulierte Distanz >= km). */
export function pointAtKm(coords, km) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += distKm(coords[i - 1], coords[i]);
    if (d >= km) return coords[i];
  }
  return coords[coords.length - 1];
}

/** Deterministischer Zufallsgenerator (mulberry32), damit Varianten reproduzierbar sind. */
export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
