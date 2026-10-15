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
    await page.screenshot({ path: SHOTS + 'desktop-surface.png' });
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
} finally {
  await browser.close();
  server.close();
}

for (const [s, name, msg] of results) console.log(`${s === 'ok' ? '✔' : '✘'} ${name}${msg ? `\n    ${msg}` : ''}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed} von ${results.length} Schritten bestanden.`);
process.exit(failed ? 1 : 0);
