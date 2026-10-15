import { fetchWithTimeout } from './http.js';

// Wegpunkt-Kandidaten aus OpenStreetMap (Overpass API).
// Liefert pro Fahrradtyp einen Pool [{ coord:[lon,lat], q:0..1 }] –
// q ist die Eignung als Wegpunkt (1 = ideal). Ein Fehler ist nicht fatal:
// Der Planer arbeitet dann mit geometrischen Wegpunkten weiter.

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UNPAVED = /^(unpaved|gravel|fine_gravel|compacted|ground|dirt|earth|sand|grass|pebblestone|mud)$/;
const PAVED = /^(asphalt|paved|concrete|paving_stones|sett|cobblestone)$/;

export function createOverpass({ mirrors = MIRRORS, timeoutMs = 20000 } = {}) {
  const cache = new Map();

  async function query(ql) {
    if (cache.has(ql)) return cache.get(ql);
    let lastErr;
    for (const url of mirrors) {
      try {
        const r = await fetchWithTimeout(url, { method: 'POST', body: 'data=' + encodeURIComponent(ql) }, timeoutMs);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (cache.size > 30) cache.delete(cache.keys().next().value);
        cache.set(ql, d);
        return d;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Overpass nicht erreichbar');
  }

  const centerOf = (e) => (e.center ? [e.center.lon, e.center.lat] : e.lon != null ? [e.lon, e.lat] : null);

  function rate(e, bike, hot) {
    const t = e.tags || {};
    const hw = t.highway || '';
    const s = (t.surface || '').toLowerCase();
    const isForest = t.landuse === 'forest' || t.natural === 'wood' || t.leisure === 'park';
    if (isForest) return hot ? 1 : 0.5;
    let q;
    if (bike === 'road') {
      if (PAVED.test(s)) q = hw === 'cycleway' ? 0.95 : 1;
      else if (!s) q = 0.75;
      else q = 0.1;
    } else if (bike === 'hardcore') {
      if (PAVED.test(s) || t.tracktype === 'grade1') q = 0.1;
      else if (UNPAVED.test(s) || /^grade[2-5]$/.test(t.tracktype || '')) q = 1;
      else q = hw === 'track' ? 0.8 : 0.75;
    } else {
      if (PAVED.test(s) || t.tracktype === 'grade1') q = 0.45;
      else if (UNPAVED.test(s) || /^grade[2-4]$/.test(t.tracktype || '')) q = 1;
      else q = 0.8;
    }
    return hot ? q * 0.6 : q;
  }

  /** Kandidaten im Umkreis radiusKm um center. */
  async function candidates({ center, radiusKm, bike, hot }) {
    const R = Math.round(Math.min(60, Math.max(5, radiusKm)) / 5) * 5000; // 5-km-Stufen → Cache-Treffer
    const [lo, la] = center;
    const around = `(around:${R},${la},${lo})`;
    let body;
    if (bike === 'road') {
      body = `way["highway"~"^(secondary|tertiary|unclassified|cycleway)$"]["surface"~"^(asphalt|paved|concrete)$"]${around};
        way["highway"~"^(secondary|tertiary)$"][!"surface"]${around};`;
      if (hot) body += `way["leisure"="park"]${around};`;
    } else {
      body = `way["highway"="track"]${around};
        way["highway"~"^(path|bridleway)$"]["bicycle"!="no"]["surface"!~"^(asphalt|paved|concrete)$"]${around};`;
      if (hot) body += `way["landuse"="forest"]${around};way["natural"="wood"]${around};`;
    }
    const d = await query(`[out:json][timeout:25];(${body});out center qt 600;`);
    return (d.elements || [])
      .map((e) => ({ coord: centerOf(e), q: rate(e, bike, hot) }))
      .filter((c) => c.coord && c.q > 0.05);
  }

  return { name: 'overpass', candidates };
}
