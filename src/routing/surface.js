// Belag-Analyse auf Basis der BRouter-Segmentdaten (properties.messages).
// Erste Zeile = Spaltennamen, danach pro Segment u. a. Longitude/Latitude
// (Mikrograd, Segment-Ende), Distance (m) und WayTags ("highway=track surface=gravel …").

export const SURFACE_COLORS = {
  asphalt: '#64748b', paved: '#94a3b8', concrete: '#7c8fa8', paving_stones: '#a8a29e',
  gravel: '#d97706', fine_gravel: '#f59e0b', compacted: '#b45309', ground: '#92400e',
  dirt: '#a16207', earth: '#a16207', sand: '#fbbf24', grass: '#22c55e', grass_paver: '#4ade80',
  mud: '#78350f', wood: '#a3704e', metal: '#6b7280', cobblestone: '#9ca3af', sett: '#9ca3af',
  pebblestone: '#d97706', unpaved: '#b45309', road_untagged: '#556577',
  track_untagged: '#c2803d', unknown: '#475569', other: '#475569',
};

export const SURFACE_LABELS = {
  asphalt: 'Asphalt', paved: 'Befestigt', concrete: 'Beton', paving_stones: 'Pflaster',
  gravel: 'Schotter', fine_gravel: 'Feiner Schotter', compacted: 'Verdichtet',
  ground: 'Boden', dirt: 'Erde', earth: 'Erde', sand: 'Sand', grass: 'Gras',
  grass_paver: 'Rasengitter', mud: 'Matsch', wood: 'Holz', metal: 'Metall',
  cobblestone: 'Kopfsteinpflaster', sett: 'Großpflaster', pebblestone: 'Kies',
  unpaved: 'Unbefestigt', road_untagged: 'Straße (o. Angabe)',
  track_untagged: 'Weg (o. Angabe)', unknown: 'Unbekannt', other: 'Sonstiges',
};

const PAVED = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone']);
const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'compacted', 'ground', 'dirt', 'earth',
  'sand', 'grass', 'mud', 'pebblestone', 'grass_paver']);
const OFFROAD_HW = new Set(['track', 'path', 'bridleway']);
const ROAD_HW = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
  'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);
const MAJOR_ROAD_HW = new Set(['primary', 'primary_link', 'secondary', 'secondary_link']);

/** BRouter-messages → [{ lonM, latM, distM, tags }] */
export function parseMessages(messages) {
  if (!messages || messages.length < 2) return [];
  const head = messages[0];
  const iLon = head.indexOf('Longitude'), iLat = head.indexOf('Latitude');
  const iDist = head.indexOf('Distance'), iTags = head.indexOf('WayTags');
  if (iLon < 0 || iDist < 0 || iTags < 0) return [];
  return messages.slice(1).map((r) => {
    const tags = {};
    for (const kv of String(r[iTags] || '').split(' ')) {
      const p = kv.indexOf('=');
      if (p > 0) tags[kv.slice(0, p)] = kv.slice(p + 1);
    }
    return { lonM: +r[iLon], latM: +r[iLat], distM: +r[iDist] || 0, tags };
  });
}

/** Belag-Schlüssel eines Segments; fehlt surface, wird nach Wegtyp geschätzt. */
export function surfaceKey(tags) {
  const s = String(tags.surface || '').toLowerCase().replace(/ /g, '_');
  if (s) return s;
  const hw = tags.highway || '';
  if (OFFROAD_HW.has(hw)) return tags.tracktype === 'grade1' ? 'paved' : 'track_untagged';
  if (hw) return 'road_untagged';
  return 'unknown';
}

/**
 * Ist ein Segment befestigt? 'paved' | 'unpaved' | 'unknown'.
 * Ungetaggte Straßen gelten als befestigt (in DE fast immer Asphalt),
 * ungetaggte Feld-/Waldwege als unbefestigt.
 */
export function pavedClass(tags) {
  const s = String(tags.surface || '').toLowerCase();
  if (PAVED.has(s)) return 'paved';
  if (UNPAVED.has(s)) return 'unpaved';
  const hw = tags.highway || '';
  if (OFFROAD_HW.has(hw)) return tags.tracktype === 'grade1' ? 'paved' : 'unpaved';
  if (ROAD_HW.has(hw) || hw === 'cycleway') return 'paved';
  return 'unknown';
}

// Risiko-Stufen für Rennrad (Farbe = Karten-Outline, w = Gewicht im Risiko-Anteil)
export const ROAD_RISK = {
  safe: { w: 0.05, color: null },
  caution: { w: 0.05, color: null },
  risky: { w: 0.70, color: '#f97316' },
  bad: { w: 0.90, color: '#dc2626' },
  severe: { w: 1.00, color: '#7f1d1d' },
};

export function roadRisk(tags) {
  const s = String(tags.surface || '').toLowerCase().replace(/ /g, '_');
  const hw = String(tags.highway || '').toLowerCase();
  if (s === 'mud') return { level: 'severe', hard: false };
  if (UNPAVED.has(s)) return { level: 'bad', hard: false };
  if (PAVED.has(s) && s !== 'sett' && s !== 'cobblestone') return { level: 'safe', hard: false };
  if (OFFROAD_HW.has(hw) || hw === 'footway' || hw === 'steps') return { level: 'bad', hard: true };
  if (!s && (hw === 'service' || hw === 'unclassified')) return { level: 'risky', hard: false };
  return { level: 'caution', hard: false };
}

/**
 * Kennzahlen einer Route für Bewertung und Anzeige.
 * Liefert km je Belag, Anteile befestigt/unbefestigt, Straßenanteil,
 * Rennrad-Risiko und eine profilabhängige Warnung.
 */
export function analyzeSurface(rows, bike) {
  const breakdown = {};
  let total = 0, paved = 0, unpaved = 0, road = 0, majorRoad = 0, risk = 0, hard = false;
  for (const r of rows) {
    const km = r.distM / 1000;
    total += km;
    const key = surfaceKey(r.tags);
    breakdown[key] = (breakdown[key] || 0) + km;
    const pc = pavedClass(r.tags);
    if (pc === 'paved') paved += km;
    else if (pc === 'unpaved') unpaved += km;
    const hw = r.tags.highway || '';
    if (ROAD_HW.has(hw) && pc !== 'unpaved') road += km;
    if (MAJOR_ROAD_HW.has(hw)) majorRoad += km;
    const rk = roadRisk(r.tags);
    risk += km * ROAD_RISK[rk.level].w;
    if (rk.hard) hard = true;
  }
  const share = (x) => (total > 0 ? x / total : 0);
  const out = {
    totalKm: total,
    breakdown,
    pavedShare: share(paved),
    unpavedShare: share(unpaved),
    roadShare: share(road),
    majorRoadShare: share(majorRoad),
    roadRiskPct: share(risk) * 100,
    hasOffroadSegment: hard,
    warning: null,
  };
  if (!rows.length) return out;
  if (bike === 'road' && (hard || out.roadRiskPct > 5)) {
    out.warning = hard
      ? 'Die Route enthält einen unbefestigten Wegabschnitt.'
      : `${Math.round(out.roadRiskPct)} % der Strecke haben einen unsicheren Belag.`;
  }
  if (bike === 'hardcore' && out.pavedShare > 0.25) {
    out.warning = `${Math.round(out.pavedShare * 100)} % der Strecke sind befestigt – in dieser Gegend gibt es wenig zusammenhängende Schotterwege.`;
  }
  return out;
}

const ckey = (c) => Math.round(c[0] * 1e6) + ',' + Math.round(c[1] * 1e6);

function matchIndex(coords, lonM, latM, start) {
  for (let i = start; i < coords.length; i++) {
    if (Math.round(coords[i][0] * 1e6) === lonM && Math.round(coords[i][1] * 1e6) === latM) return i;
  }
  let best = start, bd = Infinity;
  const end = Math.min(coords.length, start + 500);
  for (let i = start; i < end; i++) {
    const d = Math.abs(coords[i][0] * 1e6 - lonM) + Math.abs(coords[i][1] * 1e6 - latM);
    if (d < bd) { bd = d; best = i; }
  }
  return bd < 3000 ? best : start;
}

/**
 * Belag-Info je Koordinate auf der ORIGINAL-Geometrie festhalten.
 * Die Map wird über Koordinaten-Identität angesprochen und übersteht damit
 * das spätere Entfernen von Stichstrecken (dort werden nur Punkte gelöscht).
 */
export function surfaceKeyMap(rows, coords) {
  const n = coords.length;
  const keyAt = new Array(n).fill(null);
  const lvlAt = new Array(n).fill('safe');
  let prev = 0;
  for (const row of rows) {
    const key = surfaceKey(row.tags);
    const level = roadRisk(row.tags).level;
    const to = Math.max(matchIndex(coords, row.lonM, row.latM, prev), prev);
    for (let i = prev; i <= to && i < n; i++) { keyAt[i] = key; lvlAt[i] = level; }
    prev = to;
  }
  const lastKey = keyAt[prev] || 'unknown', lastLvl = lvlAt[prev] || 'safe';
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(ckey(coords[i]), { key: keyAt[i] ?? lastKey, level: keyAt[i] ? lvlAt[i] : lastLvl });
  return map;
}

/** Zeichen-Segmente (Lauflängen) aus Geometrie + keyMap. */
export function surfaceSegments(coords, keyMap) {
  const n = coords.length;
  const keys = new Array(n), lvls = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = keyMap.get(ckey(coords[i])) || { key: 'unknown', level: 'safe' };
    keys[i] = v.key; lvls[i] = v.level;
  }
  const runs = (arr) => {
    const out = []; let s = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || arr[i] !== arr[s]) { out.push({ from: s, to: i === n ? n - 1 : i, value: arr[s] }); s = i; }
    }
    return out;
  };
  return {
    segs: runs(keys).map((r) => ({ from: r.from, to: r.to, key: r.value })),
    riskSegs: runs(lvls).filter((r) => ROAD_RISK[r.value]?.color).map((r) => ({ from: r.from, to: r.to, level: r.value })),
  };
}
