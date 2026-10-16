import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distKm, bearing, angleDiff, lineKm } from '../../src/core/geo.js';
import { generateLayouts, waypointCount, mergeVias, minLoopKmThroughVias, DETOUR } from '../../src/routing/loopgen.js';
import { analyzeSurface, parseMessages, pavedClass, surfacePieces, breakdownFromPieces } from '../../src/routing/surface.js';
import { distanceScore, surfaceScore, overlapShare, directionScore, scoreRoute } from '../../src/routing/scoring.js';
import { removeBacktracks } from '../../src/routing/backtrack.js';
import { planRoundTrip } from '../../src/routing/planner.js';
import { PROFILES } from '../../src/routing/profiles.js';
import { unreachablePointIndex } from '../../src/services/brouter.js';
import { createMockRouting, createMockPois } from '../../src/services/mock.js';

const START = [9.732, 52.376];

test('waypointCount skaliert mit der Distanz', () => {
  assert.equal(waypointCount(30), 3);
  assert.equal(waypointCount(120), 6);
  assert.equal(waypointCount(400), 8);
});

test('Layouts: erster Wegpunkt zeigt ungefähr in die Kompassrichtung', () => {
  for (const heading of [0, 90, 200, 315]) {
    const ls = generateLayouts({ start: START, distKm: 60, bike: 'gravel', heading, seed: 7, count: 6 });
    for (const l of ls) {
      const b = bearing(START, l.generated[0]);
      assert.ok(angleDiff(b, heading) <= 16, `heading ${heading}: erster Punkt bei ${b.toFixed(0)}°`);
    }
  }
});

test('Layouts: Polygonumfang × Umwegfaktor liegt nahe an der Zieldistanz', () => {
  const ls = generateLayouts({ start: START, distKm: 80, bike: 'road', seed: 3, count: 6 });
  for (const l of ls) {
    const km = lineKm([START, ...l.generated, START]) * DETOUR.road;
    assert.ok(km > 80 * 0.85 && km < 80 * 1.15, `war ${km.toFixed(1)} km`);
  }
});

test('Layouts sind mit gleichem Seed reproduzierbar', () => {
  const a = generateLayouts({ start: START, distKm: 50, bike: 'road', seed: 11 });
  const b = generateLayouts({ start: START, distKm: 50, bike: 'road', seed: 11 });
  assert.deepEqual(a.map((l) => l.generated), b.map((l) => l.generated));
});

test('mergeVias behält alle Zwischenziele', () => {
  const [l] = generateLayouts({ start: START, distKm: 60, bike: 'gravel', seed: 1, count: 1 });
  const vias = [[9.9, 52.45], [9.6, 52.3]];
  const merged = mergeVias(START, l, l.generated, vias);
  for (const v of vias) assert.ok(merged.some((p) => p === v));
});

test('minLoopKmThroughVias: weit entfernte Zwischenziele erhöhen die Mindestdistanz', () => {
  assert.equal(minLoopKmThroughVias(START, []), 0);
  assert.ok(minLoopKmThroughVias(START, [[10.5, 52.376]]) > 100);
});

const msg = (rows) => [['Longitude', 'Latitude', 'Distance', 'WayTags'], ...rows.map(([d, t], i) => [String(i), String(i), String(d), t])];

test('Belag: Hardcore-Route auf Schotter vs. Asphalt', () => {
  const gravel = analyzeSurface(parseMessages(msg([[4000, 'highway=track surface=gravel'], [1000, 'highway=tertiary surface=asphalt']])), 'hardcore');
  const asphalt = analyzeSurface(parseMessages(msg([[1000, 'highway=track surface=gravel'], [4000, 'highway=secondary surface=asphalt']])), 'hardcore');
  assert.ok(Math.abs(gravel.unpavedShare - 0.8) < 1e-9);
  assert.ok(surfaceScore(gravel, 'hardcore') > surfaceScore(asphalt, 'hardcore') + 0.4);
  assert.equal(gravel.warning, null);
  assert.match(asphalt.warning, /befestigt/);
});

test('Belag: Rennrad warnt bei Feldweg', () => {
  const s = analyzeSurface(parseMessages(msg([[5000, 'highway=tertiary surface=asphalt'], [300, 'highway=track']])), 'road');
  assert.ok(s.hasOffroadSegment);
  assert.ok(s.warning);
});

test('pavedClass: ungetaggter Feldweg gilt als unbefestigt, grade1 als befestigt', () => {
  assert.equal(pavedClass({ highway: 'track' }), 'unpaved');
  assert.equal(pavedClass({ highway: 'track', tracktype: 'grade1' }), 'paved');
  assert.equal(pavedClass({ highway: 'residential' }), 'paved');
});

test('surfacePieces: Länge, Mittelpunkt und auch winzige Abschnitte', () => {
  const coords = [[10, 52], [10.01, 52], [10.02, 52], [10.02005, 52], [10.03, 52]];
  const segs = [{ from: 0, to: 2, key: 'asphalt' }, { from: 2, to: 3, key: 'grass' }, { from: 3, to: 4, key: 'asphalt' }];
  const pieces = surfacePieces(coords, segs);
  assert.equal(pieces.length, 3);
  assert.ok(Math.abs(pieces[0].km - (distKm(coords[0], coords[1]) + distKm(coords[1], coords[2]))) < 1e-9);
  assert.ok(pieces[1].km > 0 && pieces[1].km < 0.005, `Grasstück ${pieces[1].km}`);
  assert.deepEqual(pieces[1].mid, [10.02005, 52]);
  const bd = breakdownFromPieces(pieces);
  assert.deepEqual(Object.keys(bd).sort(), ['asphalt', 'grass']);
  assert.ok(Math.abs(bd.asphalt + bd.grass - lineKm(coords)) < 1e-9);
});

test('Planer: Belag-Abschnitte decken die angezeigte Route vollständig ab', async () => {
  const res = await planRoundTrip({ start: START, distKm: 40, bike: 'gravel', seed: 4 }, mockServices);
  for (const r of res.routes) {
    const sum = Object.values(r.breakdown).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - r.actualKm) < 0.01, `${sum} vs ${r.actualKm}`);
    for (const p of r.pieces) assert.ok(p.from >= 0 && p.to < r.coords.length && p.from <= p.to);
  }
});

test('Rennrad-Profil sperrt unbefestigte Wege statt sie nur teurer zu machen', () => {
  const road = PROFILES.road;
  assert.match(road, /else if isunpaved then 100000/);
  assert.match(road, /highway=track then \( if pavedtrack then 2\.5 else 100000 \)/);
  assert.match(road, /highway=path then \( if ispaved then 2 else 100000 \)/);
  assert.doesNotMatch(road, /else 60/);
});

test('unreachablePointIndex liest BRouter-Fehler richtig', () => {
  assert.equal(unreachablePointIndex('target island detected for section 3\n'), 4);
  assert.equal(unreachablePointIndex('start island detected for section 2'), 2);
  assert.equal(unreachablePointIndex('to-position not mapped in existing datafile'), -1);
  assert.equal(unreachablePointIndex('some other error'), null);
});

test('Planer: unerreichbarer Wegpunkt wird weggelassen statt den Kandidaten zu verlieren', async () => {
  let calls = 0, islandHits = 0;
  const islandRouting = {
    async route(points, bike) {
      calls++;
      // jeder Wegpunkt östlich von 9.80 liegt auf einer "Insel"
      const i = points.findIndex((p, k) => k > 0 && k < points.length - 1 && p[0] > 9.80);
      if (i > 0) {
        islandHits++;
        const e = new Error('Ein Wegpunkt ist mit diesem Fahrradtyp nicht erreichbar.');
        e.pointIndex = i;
        throw e;
      }
      return mockServices.routing.route(points, bike);
    },
  };
  const res = await planRoundTrip({ start: START, distKm: 40, bike: 'road', heading: 90, seed: 3 },
    { routing: islandRouting, pois: mockServices.pois });
  assert.ok(islandHits > 0, 'Testaufbau: es sollte Insel-Treffer geben');
  assert.ok(res.routes.length >= 1);
  for (const r of res.routes) assert.ok(r.waypoints.every((p) => p[0] <= 9.80));
});

test('Planer: unerreichbares Zwischenziel wird nicht still entfernt', async () => {
  const via = [9.95, 52.40];
  const routing = {
    async route(points) {
      const i = points.findIndex((p) => p === via);
      const e = new Error('Ein Wegpunkt ist mit diesem Fahrradtyp nicht erreichbar.');
      e.pointIndex = i;
      throw e;
    },
  };
  await assert.rejects(planRoundTrip({ start: START, distKm: 40, bike: 'road', vias: [via], seed: 1 },
    { routing, pois: mockServices.pois }), /nicht erreichbar/);
});

test('distanceScore ist bei Treffer maximal', () => {
  assert.equal(distanceScore(50, 50), 1);
  assert.ok(distanceScore(56, 50) < 0.4);
});

test('overlapShare erkennt Hin-und-zurück', () => {
  const out = [], back = [];
  for (let i = 0; i <= 40; i++) out.push([10 + i * 0.001, 52]);
  for (let i = 40; i >= 0; i--) back.push([10 + i * 0.001, 52]);
  const share = overlapShare([...out, ...back]);
  assert.ok(share > 0.35, `war ${share}`);
  assert.ok(overlapShare(out) < 0.01);
});

test('directionScore: richtige Richtung schlägt Gegenrichtung', () => {
  const north = [[10, 52], [10, 52.05], [10, 52.1]];
  assert.ok(directionScore(north, 11, 0) > 0.95);
  assert.ok(directionScore(north, 11, 180) < 0.05);
  assert.equal(directionScore(north, 11, null), null);
});

test('removeBacktracks entfernt eine kurze Stichstrecke', () => {
  const pts = [[10, 52], [10.002, 52], [10.004, 52], [10.004, 52.004], [10.004, 52.008], [10.004, 52.004], [10.004, 52.0001], [10.006, 52], [10.008, 52]];
  const cleaned = removeBacktracks(pts, [], 20);
  assert.ok(cleaned.length < pts.length);
  assert.ok(!cleaned.some((p) => p[1] > 52.005));
});

test('removeBacktracks lässt Zwischenziele stehen', () => {
  const pts = [[10, 52], [10.002, 52], [10.004, 52], [10.004, 52.004], [10.004, 52.008], [10.004, 52.004], [10.004, 52.0001], [10.006, 52]];
  const cleaned = removeBacktracks(pts, [[10.004, 52.008]], 20);
  assert.ok(cleaned.some((p) => p[1] === 52.008));
});

test('scoreRoute ohne Kompass ignoriert die Richtung', () => {
  const coords = [[10, 52], [10.1, 52], [10.1, 52.1], [10, 52]];
  const s = scoreRoute({ coords, actualKm: 30, targetKm: 30, surface: null, bike: 'gravel', heading: null });
  assert.equal(s.parts.direction, null);
  assert.ok(s.total > 0 && s.total <= 1);
});

const mockServices = { routing: createMockRouting({ latencyMs: 0 }), pois: createMockPois() };

test('Planer: liefert sortierte, bewertete Alternativen', async () => {
  const res = await planRoundTrip({ start: START, distKm: 50, bike: 'hardcore', heading: 90, seed: 5 }, mockServices);
  assert.ok(res.routes.length >= 2);
  for (let i = 1; i < res.routes.length; i++) assert.ok(res.routes[i - 1].score.total >= res.routes[i].score.total);
  const best = res.routes[0];
  assert.ok(Math.abs(best.actualKm - 50) / 50 < 0.25, `Distanz ${best.actualKm}`);
  assert.equal(distKm(best.coords[0], START) < 0.2, true);
});

test('Planer: Kompass beeinflusst die Startrichtung', async () => {
  for (const heading of [0, 180]) {
    const res = await planRoundTrip({ start: START, distKm: 40, bike: 'gravel', heading, seed: 2 }, mockServices);
    assert.ok(res.routes[0].score.parts.direction > 0.7, `heading ${heading}: ${res.routes[0].score.parts.direction}`);
  }
});

test('Planer: Zwischenziele landen in den Wegpunkten', async () => {
  const via = [9.85, 52.42];
  const res = await planRoundTrip({ start: START, distKm: 40, bike: 'road', vias: [via], seed: 9 }, mockServices);
  assert.ok(res.routes[0].waypoints.some((p) => p === via));
});

test('Planer: Ausfall der Kandidatensuche ist nicht fatal', async () => {
  const broken = { routing: mockServices.routing, pois: { candidates: async () => { throw new Error('offline'); } } };
  const res = await planRoundTrip({ start: START, distKm: 30, bike: 'gravel', seed: 1 }, broken);
  assert.ok(res.routes.length >= 1);
  assert.ok(res.notes.some((n) => /geometrisch/.test(n)));
});

test('Planer: wenn jedes Routing scheitert, gibt es eine verständliche Fehlermeldung', async () => {
  const failing = { routing: { route: async () => { throw new Error('BRouter nicht erreichbar.'); } }, pois: mockServices.pois };
  await assert.rejects(planRoundTrip({ start: START, distKm: 30, bike: 'road', seed: 1 }, failing), /BRouter nicht erreichbar/);
});
