// Vergleicht zwei Code-Stände des Planers live gegen BRouter (ohne Overpass).
// Aufruf: node tools/compare-versions.mjs <alterOrdner> [neuerOrdner]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [oldRoot, newRoot = '.'] = process.argv.slice(2);
const load = async (root) => {
  const u = (p) => pathToFileURL(resolve(root, p)).href;
  const { planRoundTrip } = await import(u('src/routing/planner.js'));
  const { createBrouter } = await import(u('src/services/brouter.js'));
  return { planRoundTrip, services: { routing: createBrouter(), pois: { candidates: async () => [] } } };
};
const versions = { alt: await load(oldRoot), neu: await load(newRoot) };
const STARTS = { 'Bienenbüttel': [10.4855, 53.1438], 'Lüneburg': [10.4140, 53.2480], 'Uelzen': [10.5600, 52.9650] };
const rows = [];
for (const bike of ['road', 'gravel', 'hardcore']) {
  for (const [name, start] of Object.entries(STARTS)) {
    const row = { bike, start: name };
    for (const [v, { planRoundTrip, services }] of Object.entries(versions)) {
      try {
        const t0 = Date.now();
        const res = await planRoundTrip({ start, distKm: 50, bike, heading: null, seed: 7 }, services);
        const b = res.routes[0];
        row[`${v} km`] = b.actualKm.toFixed(1);
        row[`${v} Belag`] = Math.round(b.score.parts.surface * 100);
        row[`${v} Var.`] = res.routes.length;
        row[`${v} s`] = Math.round((Date.now() - t0) / 1000);
      } catch (e) { row[`${v} km`] = 'Fehler'; }
    }
    rows.push(row);
  }
}
console.table(rows);
