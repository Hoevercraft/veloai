// Vergleicht den Planer mit und ohne Abstecher-Korrektur gegen echtes BRouter.
// Aufruf: node tools/compare-planner.mjs [bike]   (Overpass wird nicht genutzt)
import { planRoundTrip } from '../src/routing/planner.js';
import { createBrouter } from '../src/services/brouter.js';

const bike = process.argv[2] || 'road';
const STARTS = { 'Bienenbüttel': [10.4855, 53.1438], 'Lüneburg': [10.4140, 53.2480], 'Uelzen': [10.5600, 52.9650] };
const services = { routing: createBrouter(), pois: { candidates: async () => [] } };
const rows = [];
for (const [name, start] of Object.entries(STARTS)) {
  for (const fixDetours of [false, true]) {
    const t0 = Date.now();
    const res = await planRoundTrip({ start, distKm: 50, bike, heading: null, seed: 7 }, services, () => {}, { fixDetours });
    const b = res.routes[0];
    rows.push({ name, fix: fixDetours ? 'mit' : 'ohne', km: b.actualKm.toFixed(1), score: Math.round(b.score.total * 100),
      doppelt: (b.score.overlapShare * 100).toFixed(1) + ' %', korrigiert: res.routes.reduce((s, r) => s + (r.detoursFixed || 0), 0),
      gescheitert: res.failed, sek: Math.round((Date.now() - t0) / 1000) });
  }
}
console.table(rows);
