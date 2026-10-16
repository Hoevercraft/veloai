// Misst gegen echtes BRouter, wie oft Wegpunkte Abstecher erzwingen.
// Aufruf: node tools/detour-survey.mjs [bike]   (in der Claude-Cloud mit NODE_USE_ENV_PROXY=1)
import { generateLayouts } from '../src/routing/loopgen.js';
import { createBrouter } from '../src/services/brouter.js';
import { parseMessages } from '../src/routing/surface.js';
import { tagsPerCoord, findDetourFixes } from '../src/routing/detours.js';
import { mapLimit } from '../src/services/http.js';

const bike = process.argv[2] || 'road';
const STARTS = {
  'Bienenbüttel': [10.4855, 53.1438], 'Lüneburg': [10.4140, 53.2480],
  'Uelzen': [10.5600, 52.9650], 'Burgwedel': [9.8573, 52.4935],
};
const brouter = createBrouter();
const jobs = [];
for (const [name, start] of Object.entries(STARTS))
  for (const seed of [1, 2])
    for (const l of generateLayouts({ start, distKm: 50, bike, seed, count: 6 })) jobs.push({ name, start, l });

const reasons = {};
let routes = 0, wps = 0, withDetour = 0, detourKm = 0, failed = 0, afterWith = 0, afterKm = 0;
const examples = [];
await mapLimit(jobs, 3, async ({ name, start, l }) => {
  try {
    const raw = await brouter.route([start, ...l.generated, start], bike);
    const tags = tagsPerCoord(parseMessages(raw.messages), raw.coords);
    const fixes = findDetourFixes({ coords: raw.coords, tags, waypoints: l.generated, bike });
    routes++; wps += l.generated.length;
    if (fixes.length) { withDetour++; detourKm += fixes.reduce((s, f) => s + f.detourKm, 0); }
    if (fixes.length && examples.length < 4) examples.push(`${name} ${l.id}: ${fixes.map((f) => f.detourKm.toFixed(1) + ' km').join(', ')}`);
    if (fixes.length) {
      // Korrektur wie im Planer: Wegpunkte auf die Abzweigstelle setzen, neu rechnen, Rest zählen
      const moved = l.generated.map((p, i) => fixes.find((f) => f.index === i)?.to ?? p);
      const raw2 = await brouter.route([start, ...moved, start], bike);
      const tags2 = tagsPerCoord(parseMessages(raw2.messages), raw2.coords);
      const rest = findDetourFixes({ coords: raw2.coords, tags: tags2, waypoints: moved, bike });
      if (rest.length) { afterWith++; afterKm += rest.reduce((s, f) => s + f.detourKm, 0); }
    }
  } catch (e) { failed++; reasons[e.message] = (reasons[e.message] || 0) + 1; }
});
console.log(`${bike}: ${routes} Routen, ${wps} Wegpunkte, ${withDetour} Routen mit Abstecher (${(withDetour / routes * 100).toFixed(0)} %), zusammen ${detourKm.toFixed(1)} km Umweg, ${failed} gescheitert`);
console.log(`nach Korrektur: ${afterWith} Routen mit Abstecher (${(afterWith / routes * 100).toFixed(0)} %), zusammen ${afterKm.toFixed(1)} km Umweg`);
for (const e of examples) console.log('  ' + e);
if (failed) console.log('Fehlergründe:', reasons);
