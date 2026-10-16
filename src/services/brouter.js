import { PROFILES, FALLBACK_PROFILE } from '../routing/profiles.js';
import { fetchWithTimeout } from './http.js';

// Routing über brouter.de – kostenlos, ohne API-Key.
// Eigene Profile werden einmal pro Sitzung hochgeladen und die ID gecacht.

const BASE = 'https://brouter.de/brouter';

export function createBrouter({ base = BASE, timeoutMs = 30000 } = {}) {
  const profileIds = {};
  const pending = {};

  async function uploadProfile(bike) {
    if (profileIds[bike]) return profileIds[bike];
    // Parallele Kandidaten sollen das Profil nur einmal hochladen
    pending[bike] ??= (async () => {
      const res = await fetchWithTimeout(`${base}/profile`, { method: 'POST', body: PROFILES[bike] }, 15000);
      if (!res.ok) throw new Error('Profil-Upload HTTP ' + res.status);
      const d = await res.json();
      if (d.error || !d.profileid) throw new Error(d.error || 'Keine Profil-ID erhalten');
      profileIds[bike] = d.profileid;
      return d.profileid;
    })().finally(() => { delete pending[bike]; });
    return pending[bike];
  }

  /**
   * points: [[lon,lat], …] in Fahrreihenfolge (Start … Start)
   * → { coords:[[lon,lat,ele]], distanceKm, ascentM, durationS, messages }
   */
  async function route(points, bike) {
    let pid, custom = true;
    try { pid = await uploadProfile(bike); }
    catch (e) {
      console.warn('Eigenes Profil nicht verfügbar, nutze Standardprofil:', e.message);
      pid = FALLBACK_PROFILE[bike]; custom = false;
    }
    const lonlats = points.map((p) => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join('|');
    let busyRetries = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      let res, text;
      try {
        res = await fetchWithTimeout(`${base}?lonlats=${lonlats}&profile=${encodeURIComponent(pid)}&alternativeidx=0&format=geojson`, {}, timeoutMs);
        text = await res.text();
      } catch (e) {
        throw new Error('BRouter nicht erreichbar.');
      }
      let data = null;
      try { data = JSON.parse(text); } catch { /* kein JSON */ }
      if (res.ok && data?.features?.length) return toRoute(data.features[0]);

      const msg = data?.error || data?.message || text.replace(/<[^>]*>/g, ' ').trim().slice(0, 180) || 'HTTP ' + res.status;
      // Server kurz überlastet ("Please, retry later!" bzw. 503/429): bis zu zweimal mit Pause wiederholen
      if ((/retry later/i.test(msg) || res.status === 503 || res.status === 429) && busyRetries < 2) {
        busyRetries++;
        await new Promise((r) => setTimeout(r, 1200 * busyRetries + Math.random() * 800));
        attempt--; // zählt nicht als Profil-Versuch
        continue;
      }
      if (custom && attempt === 0 && /profil/i.test(msg)) {
        // Profil auf dem Server abgelaufen → neu hochladen
        delete profileIds[bike];
        try { pid = await uploadProfile(bike); } catch { pid = FALLBACK_PROFILE[bike]; custom = false; }
        continue;
      }
      // Wegpunkt unerreichbar (Insel im erlaubten Wegenetz oder abseits jeder Straße):
      // Index des betroffenen Punkts mitgeben, damit der Planer ihn weglassen kann.
      const unreachable = unreachablePointIndex(msg);
      if (unreachable != null) {
        const err = new Error('Ein Wegpunkt ist mit diesem Fahrradtyp nicht erreichbar.');
        err.pointIndex = unreachable;
        throw err;
      }
      throw new Error('Routing fehlgeschlagen: ' + msg);
    }
    throw new Error('Routing fehlgeschlagen.');
  }

  return { name: 'brouter', route };
}

/**
 * BRouter-Fehlertext → Index des unerreichbaren Punkts in `points`, sonst null.
 * Abschnitt N verbindet points[N] und points[N+1].
 *  "target island detected for section N"  → points[N+1]
 *  "start island detected for section N"   → points[N]
 *  "from-position not mapped …" / "to-position not mapped …" (ohne Abschnitt) → unbekannt (-1)
 */
export function unreachablePointIndex(msg) {
  const m = /(target|start) island detected for section (\d+)/i.exec(msg);
  if (m) return m[1].toLowerCase() === 'target' ? +m[2] + 1 : +m[2];
  if (/position not mapped|not mapped in existing datafile/i.test(msg)) return -1;
  return null;
}

function toRoute(f) {
  const p = f.properties || {};
  return {
    coords: f.geometry.coordinates,
    distanceKm: (parseFloat(p['track-length']) || 0) / 1000,
    ascentM: parseFloat(p['filtered ascend']) || 0,
    durationS: parseFloat(p['total-time']) || 0,
    messages: p.messages || null,
  };
}
