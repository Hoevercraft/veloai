// Minimaler statischer Server für Entwicklung und Tests: node tools/serve.mjs [port]
// Sendet wie GitHub Pages "Cache-Control: max-age=600", damit Tests das echte
// Cache-Verhalten sehen. `overrides` (Map Pfad → Inhalt) erlaubt Tests, Dateien
// zur Laufzeit auszutauschen, z. B. um ein Update zu simulieren.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

export function serve(port = 8080, { overrides = new Map() } = {}) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const rel = path.endsWith('/') ? path + 'index.html' : path;
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' };
    try {
      const body = overrides.has(rel) ? overrides.get(rel) : await readFile(file);
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('Nicht gefunden');
    }
  });
  server.overrides = overrides;
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 8080;
  await serve(port);
  console.log(`veloai läuft auf http://127.0.0.1:${port}/  (Testdaten: http://127.0.0.1:${port}/?mock=1)`);
}
