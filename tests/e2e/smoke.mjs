// Ende-zu-Ende-Test im Headless-Browser mit Testdaten (?mock=1), ohne Netzwerk.
// Aufruf: npm run test:e2e   (Screenshots landen in tests/e2e/screenshots/)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';

let pw;
try { pw = await import('playwright'); }
catch { pw = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright/index.mjs'); }

const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
const PORT = 8765;
const server = await serve(PORT);
const browser = await pw.chromium.launch();
const results = [];

async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FEHLER', name, e.message]); }
}

// Die gezeichnete Route (SVG) muss auf dem Bildschirm am Startmarker beginnen.
// Fängt den Fehler ab, bei dem Polylinien während einer Zoom-Animation versetzt landen.
async function assertRouteAtStart(page) {
  const r = await page.evaluate(() => {
    const pin = document.querySelector('.start-pin').getBoundingClientRect();
    const paths = [...document.querySelectorAll('.leaflet-overlay-pane path')];
    const boxes = paths.map((p) => p.getBoundingClientRect());
    const minX = Math.min(...boxes.map((b) => b.left)), maxX = Math.max(...boxes.map((b) => b.right));
    const minY = Math.min(...boxes.map((b) => b.top)), maxY = Math.max(...boxes.map((b) => b.bottom));
    return { cx: pin.left + pin.width / 2, cy: pin.top + pin.height / 2, minX, maxX, minY, maxY };
  });
  const tol = 8;
  assert.ok(r.cx >= r.minX - tol && r.cx <= r.maxX + tol && r.cy >= r.minY - tol && r.cy <= r.maxY + tol,
    `Startmarker (${r.cx.toFixed(0)},${r.cy.toFixed(0)}) liegt außerhalb der Route [${r.minX.toFixed(0)}–${r.maxX.toFixed(0)}, ${r.minY.toFixed(0)}–${r.maxY.toFixed(0)}]`);
}

async function newPage(viewport) {
  const page = await browser.newPage({ viewport, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  // Externe Kacheln und Schriften im Test nicht laden
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return { page, errors };
}

try {
  const { page, errors } = await newPage({ width: 1280, height: 860 });
  const t = (id) => page.getByTestId(id);
  await page.goto(`http://127.0.0.1:${PORT}/?mock=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await step('Seite lädt ohne JavaScript-Fehler, Testdaten-Hinweis sichtbar', async () => {
    await t('mock-badge').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
  });

  await step('Versionsnummer wird unten im Panel angezeigt', async () => {
    const { VERSION } = await import('../../src/version.js');
    await page.waitForTimeout(200); // Online-Abgleich abwarten
    const txt = await t('version').textContent();
    assert.match(txt, new RegExp(`^Version ${VERSION.replace(/\./g, '\\.')} vom \\d{2}\\.\\d{2}\\.\\d{4}$`));
  });

  await step('Planen ohne Start zeigt eine Anleitung', async () => {
    await t('plan-button').click();
    await t('plan-error').waitFor({ state: 'visible' });
    assert.match(await t('plan-error').textContent(), /Startpunkt/);
  });

  await step('Startpunkt über die Suche setzen', async () => {
    await t('start-input').fill('Hannover');
    await t('start-suggest').locator('button').first().click();
    await t('start-name').waitFor({ state: 'visible' });
    assert.match(await t('start-name').textContent(), /Hannover/);
  });

  await step('Hardcore wählen, Distanz auf 60 km', async () => {
    await t('bike-hardcore').click();
    assert.equal(await t('bike-hardcore').getAttribute('aria-pressed'), 'true');
    await t('distance-slider').fill('60');
    assert.equal(await t('distance-value').textContent(), '60');
  });

  await step('Kompass: Klick rechts ergibt Ost, Mitte ergibt egal', async () => {
    const box = await t('compass').boundingBox();
    await page.mouse.click(box.x + box.width * 0.92, box.y + box.height / 2);
    assert.equal(await t('heading-label').textContent(), 'Ost');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await t('heading-label').textContent(), 'Egal');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.08);
    assert.equal(await t('heading-label').textContent(), 'Nord');
  });

  await step('Zwischenziel hinzufügen', async () => {
    await t('via-add').click();
    await t('via-input-0').fill('Burgdorf');
    await page.locator('.via .suggest button').first().click();
    assert.match(await t('via-input-0').inputValue(), /Burgdorf/);
  });

  await step('Route planen liefert Varianten mit Kennzahlen', async () => {
    await t('plan-button').click();
    await t('results').waitFor({ state: 'visible', timeout: 20000 });
    assert.match(await t('variant-label').textContent(), /Variante 1 von \d/);
    assert.match(await t('stat-distance').textContent(), /km/);
    assert.ok(await t('score-direction').isVisible());
    assert.ok((await t('surface-list').locator('li').count()) > 0);
    await page.screenshot({ path: SHOTS + 'desktop-route.png' });
  });

  await step('Varianten durchblättern', async () => {
    const before = await t('variant-label').textContent();
    await t('variant-next').click();
    const after = await t('variant-label').textContent();
    assert.notEqual(before, after);
  });

  await step('Belag-Ansicht umschalten', async () => {
    await t('style-surface').click();
    assert.equal(await t('style-surface').getAttribute('aria-pressed'), 'true');
    await assertRouteAtStart(page);
    await page.screenshot({ path: SHOTS + 'desktop-surface.png' });
  });

  await step('Belag antippen markiert alle Abschnitte, nochmal antippen blendet aus', async () => {
    const items = t('surface-list').locator('button[data-key]');
    const last = t('surface-item-grass'); // Testdaten: kurze Grasstücke von ~60 m
    const key = 'grass';
    const expected = await page.evaluate((k) => {
      const s = window.veloai.state;
      return s.plan.routes[s.index].pieces.filter((p) => p.key === k && p.km < 0.5).length;
    }, key);
    assert.ok(expected > 0, 'Testdaten sollten kurze Grasstücke enthalten');
    await last.click();
    assert.equal(await last.getAttribute('aria-pressed'), 'true');
    // dicke Hervorhebungslinien liegen auf der Karte
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke-width') === '8')));
    assert.equal(await page.locator('.surface-marker').count(), expected);
    // zweiter Belag dazu → beide sichtbar
    const first = items.first();
    const key2 = await first.getAttribute('data-key');
    const expected2 = await page.evaluate((k) => {
      const s = window.veloai.state;
      return s.plan.routes[s.index].pieces.filter((p) => p.key === k && p.km < 0.5).length;
    }, key2);
    await first.click();
    assert.equal(await page.locator('.surface-marker').count(), expected + expected2);
    await page.screenshot({ path: SHOTS + 'desktop-surface-highlight.png' });
    await first.click();
    await last.click();
    assert.equal(await last.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.surface-marker').count(), 0);
  });

  await step('Desktop: Panel einklappen lässt nur die Kopfzeile stehen', async () => {
    await t('panel-toggle').click();
    const h = (await page.locator('.panel').boundingBox()).height;
    assert.ok(h < 120, `Panelhöhe ${h}`);
    assert.match(await t('brand-sub').textContent(), /km/);
    await assertRouteAtStart(page);
    await page.screenshot({ path: SHOTS + 'desktop-collapsed.png' });
    await t('panel-toggle').click();
    await t('gpx-button').waitFor({ state: 'visible' });
  });

  await step('GPX-Download enthält Trackpunkte', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), t('gpx-button').click()]);
    const path = await dl.path();
    const { readFile } = await import('node:fs/promises');
    const gpx = await readFile(path, 'utf8');
    assert.match(gpx, /<trkpt lat=/);
    assert.match(gpx, /mountain_biking/);
  });

  await step('Einstellungen überleben ein Neuladen', async () => {
    await page.reload();
    assert.equal(await t('bike-hardcore').getAttribute('aria-pressed'), 'true');
    assert.equal(await t('distance-value').textContent(), '60');
    assert.equal(await t('heading-label').textContent(), 'Nord');
  });

  await step('Keine JavaScript-Fehler während des Ablaufs', async () => assert.deepEqual(errors, []));

  const mobile = await newPage({ width: 390, height: 844 });
  await step('Mobil: Planen funktioniert, Screenshot', async () => {
    const m = mobile.page;
    await m.goto(`http://127.0.0.1:${PORT}/?mock=1`);
    await m.getByTestId('start-input').fill('Celle');
    await m.getByTestId('start-suggest').locator('button').first().click();
    await m.getByTestId('bike-road').click();
    await m.getByTestId('plan-button').click();
    await m.getByTestId('results').waitFor({ state: 'visible', timeout: 20000 });
    await m.screenshot({ path: SHOTS + 'mobile-top.png' });
    await m.getByTestId('results').scrollIntoViewIfNeeded();
    await m.screenshot({ path: SHOTS + 'mobile-results.png' });
    assert.deepEqual(mobile.errors, []);
  });

  await step('Mobil: Panel einklappen gibt der Karte fast den ganzen Bildschirm', async () => {
    const m = mobile.page;
    await m.getByTestId('panel-toggle').click();
    assert.equal(await m.getByTestId('panel-toggle').getAttribute('aria-expanded'), 'false');
    const mapH = (await m.getByTestId('map').boundingBox()).height;
    assert.ok(mapH > 844 * 0.85, `Kartenhöhe ${mapH}`);
    assert.ok(!(await m.getByTestId('plan-button').isVisible()));
    assert.match(await m.getByTestId('brand-sub').textContent(), /km, \d+ Hm/);
    // Leaflet muss die neue Größe kennen: Kacheln/Route füllen die ganze Fläche
    const size = await m.evaluate(() => document.querySelector('.leaflet-container').clientHeight);
    assert.ok(size > 844 * 0.85);
    await assertRouteAtStart(m);
    await m.screenshot({ path: SHOTS + 'mobile-collapsed.png' });
    await m.getByTestId('panel-toggle').click();
    await m.getByTestId('plan-button').waitFor({ state: 'visible' });
    assert.deepEqual(mobile.errors, []);
  });
} finally {
  await browser.close();
  server.close();
}

for (const [s, name, msg] of results) console.log(`${s === 'ok' ? '✔' : '✘'} ${name}${msg ? `\n    ${msg}` : ''}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed} von ${results.length} Schritten bestanden.`);
process.exit(failed ? 1 : 0);
