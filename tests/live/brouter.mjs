// Live-Test gegen brouter.de (braucht Internet, läuft in GitHub Actions).
// Prüft: alle Profile lassen sich hochladen (= Syntax ok) und das Rennrad-Profil
// fährt auf einer echten Strecke keinen einzigen unbefestigten Meter.
// Aufruf: node tests/live/brouter.mjs
import assert from 'node:assert/strict';
import { PROFILES } from '../../src/routing/profiles.js';
import { createBrouter } from '../../src/services/brouter.js';
import { parseMessages, pavedClass } from '../../src/routing/surface.js';

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FEHLER', name, e.message]); }
}

for (const bike of Object.keys(PROFILES)) {
  await step(`Profil „${bike}“ wird von BRouter akzeptiert`, async () => {
    const r = await fetch('https://brouter.de/brouter/profile', { method: 'POST', body: PROFILES[bike] });
    const d = await r.json();
    assert.ok(d.profileid, `Antwort: ${JSON.stringify(d).slice(0, 300)}`);
  });
}

// Strecken durch ländliches Gebiet mit vielen Feld- und Waldwegen
const CASES = [
  { name: 'Lüneburger Heide, Bienenbüttel → Bad Bevensen', points: [[10.4855, 53.1438], [10.5843, 53.0790]] },
  { name: 'Region Hannover, Burgwedel → Isernhagen', points: [[9.8573, 52.4935], [9.8569, 52.4383]] },
];

const brouter = createBrouter();
for (const c of CASES) {
  await step(`Rennrad ${c.name}: kein unbefestigter Abschnitt`, async () => {
    const r = await brouter.route(c.points, 'road');
    const rows = parseMessages(r.messages);
    assert.ok(rows.length > 0, 'keine Segmentdaten');
    const bad = rows.filter((x) => pavedClass(x.tags) === 'unpaved');
    const km = bad.reduce((s, x) => s + x.distM, 0) / 1000;
    assert.equal(bad.length, 0, `${km.toFixed(2)} km unbefestigt: ${bad.slice(0, 3).map((x) => JSON.stringify(x.tags)).join(', ')}`);
  });
}

for (const [s, name, msg] of results) console.log(`${s === 'ok' ? '✔' : '✘'} ${name}${msg ? `\n    ${msg}` : ''}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed} von ${results.length} Live-Prüfungen bestanden.`);
process.exit(failed ? 1 : 0);
