import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSION, RELEASED } from '../../src/version.js';

test('Version in src/version.js und package.json stimmen überein', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('Versionsdatum ist ein gültiges ISO-Datum', () => {
  assert.match(RELEASED, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(RELEASED)));
});
