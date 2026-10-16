import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, distKm } from '../../src/core/geo.js';
import { tagsPerCoord, findDetourFixes, waypointIndices } from '../../src/routing/detours.js';
import { candidatesFromElements } from '../../src/services/overpass.js';
import { planRoundTrip } from '../../src/routing/planner.js';
import { createMockPois } from '../../src/services/mock.js';
import { parseMessages } from '../../src/routing/surface.js';

// Hilfen: Spur aus Teilstrecken mit Tags bauen (Punkte alle ~50 m)
function buildTrack(legs) {
  const coords = [], tags = [];
  for (const { from, to, tag } of legs) {
    const n = Math.max(1, Math.round(distKm(from, to) / 0.05));
    for (let s = coords.length ? 1 : 0; s <= n; s++) {
      const t = s / n;
      coords.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      tags.push({ highway: tag });
    }
  }
  return { coords, tags };
}

const A = [10, 52];
const R = destination(A, 5, 90);       // Punkt auf der Hauptstraße
const W = destination(R, 0.8, 0);      // Wegpunkt 800 m nördlich auf einem Stichweg
const E = destination(R, 5, 90);

test('Stichweg zum Wegpunkt wird erkannt, Wegpunkt wandert auf die Abzweigung', () => {
  const { coords, tags } = buildTrack([
    { from: A, to: R, tag: 'tertiary' },
    { from: R, to: W, tag: 'service' },
    { from: W, to: R, tag: 'service' },
    { from: R, to: E, tag: 'tertiary' },
  ]);
  const fixes = findDetourFixes({ coords, tags, waypoints: [W], bike: 'road' });
  assert.equal(fixes.length, 1);
  assert.ok(distKm(fixes[0].to, R) < 0.06, `neuer Punkt ${distKm(fixes[0].to, R).toFixed(3)} km von der Abzweigung`);
  assert.ok(Math.abs(fixes[0].detourKm - 1.6) < 0.15, `Umweg ${fixes[0].detourKm}`);
});

test('Schleifen-Abstecher (wie im Wald-Beispiel) wird erkannt', () => {
  const B = destination(R, 1.4, 180);
  const M = destination(destination(R, 1.2, 240), 0.2, 180);
  const { coords, tags } = buildTrack([
    { from: A, to: R, tag: 'tertiary' },
    { from: R, to: M, tag: 'service' },
    { from: M, to: B, tag: 'service' },
    { from: B, to: destination(B, 5, 180), tag: 'tertiary' },
  ]);
  const fixes = findDetourFixes({ coords, tags, waypoints: [M], bike: 'road' });
  assert.equal(fixes.length, 1);
});

test('Wegpunkt auf durchgehender Straße bleibt, gerade Ortsdurchfahrt ist kein Abstecher', () => {
  const V1 = destination(R, 0.6, 90), V2 = destination(V1, 0.8, 90);
  const { coords, tags } = buildTrack([
    { from: A, to: R, tag: 'tertiary' },
    { from: R, to: V1, tag: 'tertiary' },
    { from: V1, to: V2, tag: 'residential' }, // Ort, Straße läuft geradeaus weiter
    { from: V2, to: E, tag: 'tertiary' },
  ]);
  assert.equal(findDetourFixes({ coords, tags, waypoints: [R], bike: 'road' }).length, 0);
  const mid = destination(V1, 0.4, 90);
  assert.equal(findDetourFixes({ coords, tags, waypoints: [mid], bike: 'road' }).length, 0);
});

test('Zwischenziele werden nie verschoben', () => {
  const { coords, tags } = buildTrack([
    { from: A, to: R, tag: 'tertiary' },
    { from: R, to: W, tag: 'service' },
    { from: W, to: R, tag: 'service' },
    { from: R, to: E, tag: 'tertiary' },
  ]);
  assert.equal(findDetourFixes({ coords, tags, waypoints: [W], bike: 'road', protect: [W] }).length, 0);
});

test('Hardcore: Wegpunkt auf Feldweg ist richtig, auf Wohnstraße mit Abstecher nicht', () => {
  const { coords, tags } = buildTrack([
    { from: A, to: R, tag: 'track' },
    { from: R, to: W, tag: 'residential' },
    { from: W, to: R, tag: 'residential' },
    { from: R, to: E, tag: 'track' },
  ]);
  assert.equal(findDetourFixes({ coords, tags, waypoints: [W], bike: 'hardcore' }).length, 1);
  assert.equal(findDetourFixes({ coords, tags, waypoints: [R], bike: 'hardcore' }).length, 0);
});

test('tagsPerCoord ordnet BRouter-Zeilen den Spurpunkten zu', () => {
  const coords = [[10, 52], [10.001, 52], [10.002, 52], [10.003, 52], [10.004, 52]];
  const m = (c, tag) => [String(Math.round(c[0] * 1e6)), String(Math.round(c[1] * 1e6)), '70', `highway=${tag}`];
  const rows = parseMessages([['Longitude', 'Latitude', 'Distance', 'WayTags'], m(coords[2], 'tertiary'), m(coords[4], 'track')]);
  const t = tagsPerCoord(rows, coords).map((x) => x.highway);
  assert.deepEqual(t, ['tertiary', 'tertiary', 'tertiary', 'track', 'track']);
});

test('waypointIndices bleibt in Fahrreihenfolge', () => {
  const coords = [[0, 0], [1, 0], [2, 0], [1, 0], [0, 0]];
  assert.deepEqual(waypointIndices(coords, [[2, 0], [0.9, 0]]), [2, 3]);
});

test('Overpass-Kandidaten liegen auf dem Weg, kurze Stichwege fallen weg', () => {
  const curve = []; // Halbkreis: Mittelpunkt läge weit neben der Straße
  for (let a = 0; a <= 180; a += 10) {
    const p = destination([10, 52], 1, a);
    curve.push({ lon: p[0], lat: p[1] });
  }
  const stub = [{ lon: 10.1, lat: 52 }, { lon: 10.1015, lat: 52 }]; // ~100 m
  const els = [
    { type: 'way', tags: { highway: 'tertiary', surface: 'asphalt' }, geometry: curve },
    { type: 'way', tags: { highway: 'service', surface: 'asphalt' }, geometry: stub },
  ];
  const cands = candidatesFromElements(els, 'road', false, () => 1);
  assert.ok(cands.length >= 3 && cands.length <= 9, `${cands.length} Punkte`);
  for (const c of cands) assert.ok(Math.abs(distKm([10, 52], c.coord) - 1) < 0.01, 'Punkt liegt nicht auf dem Weg');
  assert.ok(!cands.some((c) => c.coord[0] > 10.05), 'Stichweg hätte wegfallen sollen');
  const area = candidatesFromElements([{ type: 'way', tags: { landuse: 'forest' }, geometry: curve }], 'gravel', true, () => 1);
  assert.equal(area.length, 1);
});

test('Planer: Abstecher werden korrigiert, Wegpunkte landen auf der Hauptstraße', async () => {
  // Fake-Routing: jeder Wegpunkt liegt 500 m neben seiner "Straße" und wird über einen
  // Stichweg (service) angefahren – außer er liegt schon auf einem Straßenpunkt.
  const roadCoords = []; // alle Punkte, die auf der Hauptstraße (tertiary) liegen
  const onRoad = (p) => roadCoords.some((c) => distKm(c, p) < 0.06);
  const msgHead = ['Longitude', 'Latitude', 'Distance', 'WayTags'];
  const routing = {
    async route(points) {
      const coords = [], messages = [msgHead];
      const add = (from, to, tag) => {
        const n = Math.max(1, Math.round(distKm(from, to) / 0.1));
        for (let s = coords.length ? 1 : 0; s <= n; s++) {
          const t = s / n;
          coords.push([+(from[0] + (to[0] - from[0]) * t).toFixed(6), +(from[1] + (to[1] - from[1]) * t).toFixed(6), 50]);
          if (tag === 'tertiary') roadCoords.push(coords[coords.length - 1]);
        }
        const end = coords[coords.length - 1];
        messages.push([String(Math.round(end[0] * 1e6)), String(Math.round(end[1] * 1e6)), String(Math.round(distKm(from, to) * 1000)), `highway=${tag} surface=asphalt`]);
      };
      let cur = points[0];
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (i === points.length - 1 || onRoad(p)) { add(cur, p, 'tertiary'); cur = p; continue; }
        const r = destination(p, 0.5, 0);
        add(cur, r, 'tertiary'); add(r, p, 'service'); add(p, r, 'service'); cur = r;
      }
      return { coords, distanceKm: 0, ascentM: 0, durationS: 0, messages };
    },
  };
  const res = await planRoundTrip({ start: [10, 52], distKm: 40, bike: 'road', seed: 3 },
    { routing, pois: createMockPois() });
  const best = res.routes[0];
  assert.ok(best.detoursFixed > 0, 'keine Korrektur angewendet');
  for (const wp of best.waypoints) assert.ok(onRoad(wp), 'Wegpunkt liegt nicht auf der Straße');
});
