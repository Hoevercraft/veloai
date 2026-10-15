import { distKm, destination, seededRandom } from '../core/geo.js';

// Test-Dienste ohne Netzwerk. Aktiv mit ?mock=1 in der URL.
// Sie liefern deterministische, plausible Daten im selben Format wie die
// echten Dienste, damit UI und Planungslogik offline geprüft werden können.

const HEAD = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'];

const TAGS = {
  road: ['highway=tertiary surface=asphalt', 'highway=secondary surface=asphalt', 'highway=cycleway surface=asphalt', 'highway=unclassified'],
  gravel: ['highway=track surface=gravel', 'highway=track tracktype=grade2', 'highway=tertiary surface=asphalt', 'highway=path surface=compacted'],
  hardcore: ['highway=track surface=gravel', 'highway=track surface=ground', 'highway=path surface=dirt', 'highway=track surface=fine_gravel', 'highway=track tracktype=grade3'],
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMockRouting({ latencyMs = 120 } = {}) {
  async function route(points, bike) {
    await delay(latencyMs);
    const coords = [];
    const messages = [HEAD];
    const tags = TAGS[bike] || TAGS.gravel;
    let segKm = 0, segIdx = 0, total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const legKm = distKm(a, b) * 1.25; // Umweg simulieren
      const steps = Math.max(2, Math.round(legKm / 0.08));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const wig = Math.sin(t * Math.PI * 6 + i) * 0.004 * Math.sin(t * Math.PI);
        const lon = a[0] + (b[0] - a[0]) * t + wig;
        const lat = a[1] + (b[1] - a[1]) * t - wig * 0.6;
        const ele = 60 + 35 * Math.sin((lon + lat) * 40);
        const pt = [+lon.toFixed(6), +lat.toFixed(6), +ele.toFixed(1)];
        if (coords.length) {
          const d = distKm(coords[coords.length - 1], pt);
          segKm += d; total += d;
        }
        coords.push(pt);
        if (segKm >= 0.6 || (i === points.length - 1 && s === steps)) {
          messages.push([String(Math.round(pt[0] * 1e6)), String(Math.round(pt[1] * 1e6)), String(Math.round(ele)),
            String(Math.round(segKm * 1000)), '1000', '0', '0', '0', '0', tags[segIdx % tags.length], '', '0', '0']);
          segKm = 0; segIdx++;
        }
      }
    }
    return { coords, distanceKm: total, ascentM: Math.round(total * 4.2), durationS: 0, messages };
  }
  return { name: 'mock-routing', route };
}

export function createMockPois() {
  async function candidates({ center, radiusKm }) {
    await delay(60);
    const rnd = seededRandom(Math.round(center[0] * 1000) ^ Math.round(center[1] * 1000));
    const out = [];
    for (let i = 0; i < 250; i++) {
      out.push({ coord: destination(center, rnd() * radiusKm, rnd() * 360), q: 0.4 + rnd() * 0.6 });
    }
    return out;
  }
  return { name: 'mock-pois', candidates };
}

export function createMockGeocoder() {
  const base = [9.7320, 52.3759]; // Hannover
  async function search(q) {
    await delay(40);
    const h = [...q].reduce((s, c) => s + c.charCodeAt(0), 0);
    return [0, 1, 2].map((k) => ({
      name: `${q} ${k ? `(Vorschlag ${k + 1})` : ''}`.trim(),
      coord: destination(base, (h % 20) + k * 3, (h * 37 + k * 90) % 360),
    }));
  }
  async function reverse(coord) {
    return `Testpunkt ${coord[1].toFixed(3)}, ${coord[0].toFixed(3)}`;
  }
  return { name: 'mock-geocoder', search, reverse };
}
