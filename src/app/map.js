import { SURFACE_COLORS, ROAD_RISK } from '../routing/surface.js';
import { BIKES } from '../routing/profiles.js';

// Kartenansicht (Leaflet). Kennt keine Planungslogik, nur Darstellung.

const L = globalThis.L;

export function createMap(container, { onPickStart }) {
  const map = L.map(container, { center: [51.16, 10.45], zoom: 6, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const tiles = {
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>, © OpenStreetMap',
    }),
  };
  let tile = 'osm';
  tiles.osm.addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const viaLayer = L.layerGroup().addTo(map);
  let startMarker = null, arrowMarker = null, hoverMarker = null;

  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.type = 'button';
    btn.dataset.testid = 'popup-set-start';
    btn.textContent = 'Start hier setzen';
    btn.addEventListener('click', () => { map.closePopup(); onPickStart([lng, lat]); });
    L.popup().setLatLng(e.latlng).setContent(btn).openOn(map);
  });

  function setTile(name) {
    if (name === tile || !tiles[name]) return;
    map.removeLayer(tiles[tile]);
    tiles[name].addTo(map);
    tile = name;
  }

  function setStart(coord, name, { fly = true } = {}) {
    if (startMarker) map.removeLayer(startMarker);
    if (!coord) { startMarker = null; return; }
    const icon = L.divIcon({ className: '', html: '<div class="start-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    startMarker = L.marker([coord[1], coord[0]], { icon, keyboard: false }).addTo(map).bindTooltip(name || 'Start', { direction: 'top', offset: [0, -8] });
    if (fly) map.setView([coord[1], coord[0]], Math.max(map.getZoom(), 12));
  }

  // Pfeil am Startpunkt zeigt die gewählte Startrichtung
  function setHeading(coord, heading, color) {
    if (arrowMarker) { map.removeLayer(arrowMarker); arrowMarker = null; }
    if (!coord || heading == null) return;
    const html = `<svg class="heading-arrow" viewBox="-32 -32 64 64" style="transform:rotate(${heading}deg)" aria-hidden="true">
      <path d="M0,-30 L8,-14 L2,-14 L2,-9 L-2,-9 L-2,-14 L-8,-14 Z" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg>`;
    arrowMarker = L.marker([coord[1], coord[0]], {
      icon: L.divIcon({ className: '', html, iconSize: [64, 64], iconAnchor: [32, 32] }),
      interactive: false, keyboard: false,
    }).addTo(map);
  }

  function setVias(vias) {
    viaLayer.clearLayers();
    vias.forEach((v, i) => {
      if (!v.coord) return;
      const icon = L.divIcon({ className: '', html: `<div class="via-pin">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([v.coord[1], v.coord[0]], { icon, keyboard: false }).addTo(viaLayer).bindTooltip(v.name || `Zwischenziel ${i + 1}`, { direction: 'top' });
    });
  }

  function showRoute(route, { bike, bySurface, fit = true }) {
    routeLayer.clearLayers();
    clearHover();
    if (!route) return;
    const lls = route.coords.map((c) => [c[1], c[0]]);
    const color = BIKES[bike]?.color || '#333';
    L.polyline(lls, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    if (bySurface && route.segs?.length) {
      if (bike === 'road') {
        for (const r of route.riskSegs || []) {
          const part = lls.slice(r.from, r.to + 1);
          if (part.length > 1) L.polyline(part, { color: ROAD_RISK[r.level].color, weight: 12, opacity: 0.85 }).addTo(routeLayer);
        }
      }
      for (const s of route.segs) {
        const part = lls.slice(s.from, s.to + 1);
        if (part.length > 1) L.polyline(part, { color: SURFACE_COLORS[s.key] || SURFACE_COLORS.other, weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
      }
    } else {
      L.polyline(lls, { color, weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    }
    lastBounds = L.latLngBounds(lls);
    if (fit) fitRoute();
  }

  // Ohne Animation: Polylinien, die während einer laufenden Zoom-Animation
  // gezeichnet werden, landen sonst versetzt zu den Markern.
  let lastBounds = null;
  function fitRoute() {
    if (!lastBounds) return;
    const desktop = window.innerWidth > 760;
    const collapsed = document.body.classList.contains('panel-collapsed');
    map.fitBounds(lastBounds, {
      animate: false,
      paddingTopLeft: desktop ? [collapsed ? 40 : 420, collapsed ? 110 : 40] : [24, 24],
      paddingBottomRight: [40, 40],
    });
  }

  // Markiert alle Abschnitte der gewählten Beläge: dicke Linie + Marker in der
  // Abschnittsmitte, damit auch wenige Meter lange Stücke auffindbar sind.
  const highlightLayer = L.layerGroup().addTo(map);
  const MARKER_MAX_KM = 0.5;
  function highlightSurfaces(route, keys, labelOf) {
    highlightLayer.clearLayers();
    if (!route || !keys.size) return;
    const lls = route.coords.map((c) => [c[1], c[0]]);
    const pieces = (route.pieces || []).filter((p) => keys.has(p.key));
    // Erst alle Linien (Kontur, dann Farbe) …
    for (const pass of ['casing', 'fill']) {
      for (const p of pieces) {
        const part = lls.slice(p.from, p.to + 1);
        if (part.length < 2) continue;
        const style = pass === 'casing'
          ? { color: '#1e2a2b', weight: 13, opacity: 0.9 }
          : { color: SURFACE_COLORS[p.key] || SURFACE_COLORS.other, weight: 8, opacity: 1 };
        L.polyline(part, { ...style, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(highlightLayer);
      }
    }
    // … dann die Marker obendrauf, damit sie nie verdeckt werden
    for (const p of pieces) {
      const color = SURFACE_COLORS[p.key] || SURFACE_COLORS.other;
      // Lange Abschnitte sind als Linie gut sichtbar – Marker nur für kurze Stücke
      if (p.km >= MARKER_MAX_KM) continue;
      const len = p.km < 0.1 ? `${Math.max(1, Math.round(p.km * 1000))} m` : `${p.km.toFixed(1).replace('.', ',')} km`;
      L.circleMarker([p.mid[1], p.mid[0]], {
        radius: 9, weight: 3, color: '#1e2a2b', fillColor: color, fillOpacity: 1, className: 'surface-marker',
      }).addTo(highlightLayer).bindTooltip(`${labelOf(p.key)}, ${len}`, { direction: 'top', offset: [0, -6] });
    }
  }

  function showHover(coord, color) {
    const ll = [coord[1], coord[0]];
    if (!hoverMarker) hoverMarker = L.circleMarker(ll, { radius: 7, weight: 3, color: '#fff', fillColor: color, fillOpacity: 1 }).addTo(map);
    else hoverMarker.setLatLng(ll);
  }
  function clearHover() {
    if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null; }
  }

  // Nach Größenänderung des Kartencontainers (Panel ein-/ausklappen) neu vermessen,
  // Kartenmitte dabei beibehalten
  function resize({ refit = false } = {}) {
    map.invalidateSize({ pan: false });
    if (refit) fitRoute();
  }

  return { map, resize, fitRoute, highlightSurfaces, setTile, setStart, setHeading, setVias, showRoute, showHover, clearHover };
}
