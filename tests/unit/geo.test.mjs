import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distKm, bearing, angleDiff, destination, lineKm, seededRandom } from '../../src/core/geo.js';

test('distKm: Hannover → Hamburg ≈ 132 km', () => {
  const d = distKm([9.732, 52.376], [9.993, 53.551]);
  assert.ok(d > 128 && d < 136, `war ${d}`);
});

test('bearing: genau nach Norden ≈ 0°, nach Osten ≈ 90°', () => {
  assert.ok(bearing([10, 52], [10, 53]) < 0.5);
  assert.ok(Math.abs(bearing([10, 52], [10.1, 52]) - 90) < 0.5);
});

test('angleDiff berücksichtigt den 0/360-Übergang', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(90, 270), 180);
});

test('destination und distKm sind konsistent', () => {
  const p = destination([10, 52], 25, 137);
  assert.ok(Math.abs(distKm([10, 52], p) - 25) < 0.01);
  assert.ok(angleDiff(bearing([10, 52], p), 137) < 0.5);
});

test('lineKm summiert Teilstrecken', () => {
  const a = [10, 52], b = destination(a, 3, 90), c = destination(b, 4, 0);
  assert.ok(Math.abs(lineKm([a, b, c]) - 7) < 0.01);
});

test('seededRandom ist reproduzierbar', () => {
  const r1 = seededRandom(42), r2 = seededRandom(42);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
});
