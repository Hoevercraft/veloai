import { fetchWithTimeout } from './http.js';

// Ortssuche: Photon (komoot) für Suche + Autovervollständigung,
// Nominatim nur für Rückwärtssuche (Koordinate → Name). Beide ohne API-Key.

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

export function photonLabel(f) {
  const p = f.properties || {};
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.state || 'Unbenannter Ort';
  const sub = [p.postcode, p.city && p.city !== main ? p.city : null, !p.city && p.state && p.state !== main ? p.state : null]
    .filter(Boolean).join(' ');
  return sub ? `${main}, ${sub}` : main;
}

export function createGeocoder() {
  /** → [{ name, coord:[lon,lat] }] */
  async function search(q, bias = null, limit = 5) {
    let url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}&lang=de`;
    if (bias) url += `&lat=${bias[1]}&lon=${bias[0]}`;
    const r = await fetchWithTimeout(url, {}, 10000);
    if (!r.ok) throw new Error('Ortssuche HTTP ' + r.status);
    const d = await r.json();
    return (d.features || [])
      .filter((f) => f.geometry?.coordinates)
      .map((f) => ({ name: photonLabel(f), coord: f.geometry.coordinates.slice(0, 2) }));
  }

  async function reverse(coord) {
    const fallback = `${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}`;
    try {
      const r = await fetchWithTimeout(`${NOMINATIM}?lat=${coord[1]}&lon=${coord[0]}&format=json&accept-language=de`, {}, 8000);
      const d = await r.json();
      return d.display_name ? d.display_name.split(',').slice(0, 2).join(', ').trim() : fallback;
    } catch {
      return fallback;
    }
  }

  return { name: 'photon', search, reverse };
}
