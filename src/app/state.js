// App-Zustand mit Persistenz im localStorage.
// Nur Einstellungen werden gespeichert, keine berechneten Routen.

const KEY = 'veloai_state_v1';
const BIKES = ['road', 'gravel', 'hardcore'];

export function createState() {
  const state = {
    start: null,          // { coord:[lon,lat], name }
    bike: 'gravel',
    distKm: 50,
    heading: null,        // 0–345 in 15°-Schritten oder null = egal
    hot: false,
    speed: 0,             // 0 = automatisch
    vias: [],             // [{ q, coord:[lon,lat]|null, name }]
    tile: 'osm',
    colorBySurface: false,
    seed: Math.floor(Math.random() * 1e6),
    plan: null,           // Ergebnis von planRoundTrip
    index: 0,             // gewählte Variante
  };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (BIKES.includes(s.bike)) state.bike = s.bike;
      if (s.distKm >= 10 && s.distKm <= 200) state.distKm = s.distKm;
      if (s.heading == null || (s.heading >= 0 && s.heading < 360)) state.heading = s.heading ?? null;
      state.hot = !!s.hot;
      state.speed = s.speed > 0 ? s.speed : 0;
      state.tile = s.tile === 'topo' ? 'topo' : 'osm';
      state.colorBySurface = !!s.colorBySurface;
      if (Array.isArray(s.start?.coord)) state.start = s.start;
      if (Array.isArray(s.vias)) state.vias = s.vias.filter((v) => v && Array.isArray(v.coord)).slice(0, 3);
    } catch (e) {
      console.warn('Einstellungen konnten nicht geladen werden:', e.message);
    }
  }

  function save() {
    try {
      const { start, bike, distKm, heading, hot, speed, vias, tile, colorBySurface } = state;
      localStorage.setItem(KEY, JSON.stringify({ start, bike, distKm, heading, hot, speed, tile, colorBySurface, vias: vias.filter((v) => v.coord) }));
    } catch (e) {
      console.warn('Einstellungen konnten nicht gespeichert werden:', e.message);
    }
  }

  return { state, load, save };
}
