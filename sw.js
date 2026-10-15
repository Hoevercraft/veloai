// veloai Service Worker: "Netz zuerst" für die eigenen Dateien.
// GitHub Pages lässt Browser Dateien bis zu 10 Minuten zwischenspeichern – nach
// einem Update lief dann noch der alte Stand. Hier wird jede eigene Datei beim
// Server nachgefragt (bei unveränderter Datei nur eine kurze 304-Antwort).
// Ohne Netz liefert der Worker den zuletzt geladenen Stand.
// Fremde Server (Karten, BRouter, Overpass, Ortssuche) laufen unverändert am Worker vorbei.

const CACHE = 'veloai-offline';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: false });
      if (hit) return hit;
      throw err;
    }
  })());
});
