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
      if (custom && attempt === 0 && /profil/i.test(msg)) {
        // Profil auf dem Server abgelaufen → neu hochladen
        delete profileIds[bike];
        try { pid = await uploadProfile(bike); } catch { pid = FALLBACK_PROFILE[bike]; custom = false; }
        continue;
      }
      if (/not mapped|position/i.test(msg)) throw new Error('Ein Wegpunkt liegt außerhalb des Wegenetzes.');
      throw new Error('Routing fehlgeschlagen: ' + msg);
    }
    throw new Error('Routing fehlgeschlagen.');
  }

  return { name: 'brouter', route };
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
