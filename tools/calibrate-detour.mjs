// Misst gegen echtes BRouter das Verhältnis gefahrene km / Luftlinien-Polygon je Radtyp
// (nach Abstecher-Korrektur und Stich-Bereinigung), um DETOUR in loopgen.js zu kalibrieren.
import { generateLayouts, DETOUR } from '../src/routing/loopgen.js';
import { createBrouter } from '../src/services/brouter.js';
import { parseMessages } from '../src/routing/surface.js';
import { tagsPerCoord, findDetourFixes } from '../src/routing/detours.js';
import { removeBacktracks } from '../src/routing/backtrack.js';
import { lineKm } from '../src/core/geo.js';
import { mapLimit } from '../src/services/http.js';

const STARTS = [[10.4855, 53.1438], [10.4140, 53.2480], [10.5600, 52.9650], [9.8573, 52.4935]];
const brouter = createBrouter();
for (const bike of ['road', 'gravel', 'hardcore']) {
  const ratios = [];
  const jobs = STARTS.flatMap((start) => generateLayouts({ start, distKm: 50, bike, seed: 3, count: 6 }).map((l) => ({ start, l })));
  await mapLimit(jobs, 3, async ({ start, l }) => {
    try {
      let wps = l.generated;
      let raw = await brouter.route([start, ...wps, start], bike);
      const fixes = findDetourFixes({ coords: raw.coords, tags: tagsPerCoord(parseMessages(raw.messages), raw.coords), waypoints: wps, bike });
      if (fixes.length) {
        wps = wps.map((p, i) => fixes.find((f) => f.index === i)?.to ?? p);
        raw = await brouter.route([start, ...wps, start], bike);
      }
      const km = lineKm(removeBacktracks(raw.coords, [], 50));
      ratios.push(km / lineKm([start, ...l.generated, start]));
    } catch { /* einzelne Ausfälle ignorieren */ }
  });
  ratios.sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  console.log(`${bike}: n=${ratios.length}, Median ${med.toFixed(3)}, Mittel ${mean.toFixed(3)}, P25 ${ratios[Math.floor(ratios.length * 0.25)].toFixed(3)}, P75 ${ratios[Math.floor(ratios.length * 0.75)].toFixed(3)}  (bisher ${DETOUR[bike]})`);
}
