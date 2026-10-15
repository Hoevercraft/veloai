// BRouter-Profile je Fahrradtyp.
// costfactor >= 1 = nutzbar (höher = teurer), 100000 = gesperrt.
// Die Profile werden zur Laufzeit hochgeladen (POST /brouter/profile).
// Fällt der Upload aus, greift das eingebaute Profil aus FALLBACK_PROFILE.

export const BIKES = {
  road: {
    id: 'road',
    label: 'Rennrad',
    sub: 'Nur Asphalt, ruhige Straßen',
    speedKmh: 27,
    color: '#3d6fb6',
    gpxType: 'cycling',
  },
  gravel: {
    id: 'gravel',
    label: 'Gravel',
    sub: 'Mix aus Wirtschaftswegen und Nebenstraßen',
    speedKmh: 20,
    color: '#c08a2e',
    gpxType: 'gravel_cycling',
  },
  hardcore: {
    id: 'hardcore',
    label: 'Hardcore Gravel',
    sub: 'Schotter, Sand, Trails – Asphalt um jeden Preis meiden',
    speedKmh: 15,
    color: '#b4442b',
    gpxType: 'mountain_biking',
  },
};

export const FALLBACK_PROFILE = { road: 'fastbike', gravel: 'trekking', hardcore: 'trekking' };

const ONEWAY_AND_ACCESS = (onewayCost) => `
assign badoneway =
  if reversedirection=yes then
    ( if oneway= then junction=roundabout else oneway=yes|true|1 )
  else oneway=-1

assign onewaypenalty =
  if badoneway then
    ( if cycleway=opposite|opposite_lane|opposite_track then 0
      else if oneway:bicycle=no then 0
      else ${onewayCost} )
  else 0

assign accesspenalty =
  if bicycle=no|private then 100000
  else if motorroad=yes then 100000
  else if access=no|private then ( if bicycle=yes|permissive|designated then 0 else 100000 )
  else 0
`;

export const PROFILES = {
  // Rennrad: unbefestigte Wege sind GESPERRT (nicht nur teuer). Grund: BRouter
  // rastet Wegpunkte auf den nächsten erlaubten Weg ein. Wäre ein Waldweg nur
  // teuer, landet ein Wegpunkt dort und erzwingt einen Abstecher.
  road: `# veloai Rennrad – nur befestigte Wege
---context:global
assign validForBikes = true

---context:way
assign turncost = 120

assign ispaved   = surface=asphalt|paved|concrete|paving_stones
assign isunpaved = surface=unpaved|gravel|fine_gravel|compacted|ground|dirt|earth|sand|grass|mud|pebblestone
assign pavedtrack = or ispaved tracktype=grade1
${ONEWAY_AND_ACCESS(8)}
assign basecost =
  if highway= then 100000
  else if highway=motorway|motorway_link|trunk|trunk_link then 100000
  else if highway=steps|construction then 100000
  else if isunpaved then 100000
  else if highway=bridleway then 100000
  else if highway=footway|pedestrian then ( if ispaved then 40 else 100000 )
  else if highway=path then ( if ispaved then 2 else 100000 )
  else if highway=track then ( if pavedtrack then 2.5 else 100000 )
  else if surface=cobblestone|sett then 15
  else if smoothness=bad|very_bad|horrible|very_horrible|impassable then 40
  else if highway=cycleway then 1
  else if highway=tertiary|tertiary_link then 1
  else if highway=secondary|secondary_link then 1.2
  else if highway=unclassified then 1.2
  else if highway=primary|primary_link then 2.2
  else if highway=residential|living_street then 1.4
  else if highway=service then 3
  else 3

assign costfactor = add onewaypenalty add accesspenalty basecost

---context:node
assign initialcost = if highway=traffic_signals then 120 else 0
`,

  gravel: `# veloai Gravel – Mixed Terrain
---context:global
assign validForBikes = true

---context:way
assign turncost = 90
${ONEWAY_AND_ACCESS(5)}
assign basecost =
  if highway= then 100000
  else if highway=motorway|motorway_link|trunk|trunk_link then 100000
  else if highway=steps|construction then 100000
  else if highway=primary|primary_link then 5
  else if highway=secondary|secondary_link then 2.8
  else if highway=track then ( if tracktype=grade5 then 1.6 else 1 )
  else if highway=path|bridleway then 1.3
  else if highway=cycleway then 1
  else if highway=footway|pedestrian then 5
  else if highway=tertiary|tertiary_link then 1.6
  else if highway=unclassified|residential|living_street then 1.3
  else if highway=service then 1.5
  else 2

assign costfactor = add onewaypenalty add accesspenalty basecost

---context:node
assign initialcost = if highway=traffic_signals then 100 else 0
`,

  // Hardcore: Straßen und Asphalt sind nur als letzte Verbindung erlaubt.
  // Die Kosten steigen steil mit der Straßenklasse; asphaltierte Wege
  // kosten ein Vielfaches eines Feldwegs, damit BRouter lieber Umwege
  // über Schotter fährt als ein Stück Asphalt.
  hardcore: `# veloai Hardcore Gravel – Asphalt um jeden Preis meiden
---context:global
assign validForBikes = true

---context:way
assign turncost = 40

assign ispaved   = surface=asphalt|paved|concrete|paving_stones|sett|cobblestone
assign isunpaved = surface=unpaved|gravel|fine_gravel|compacted|ground|dirt|earth|sand|grass|mud|pebblestone
assign pavedtrack = tracktype=grade1
${ONEWAY_AND_ACCESS(4)}
assign basecost =
  if highway= then 100000
  else if highway=motorway|motorway_link|trunk|trunk_link then 100000
  else if highway=steps|construction then 100000
  else if highway=primary|primary_link then 400
  else if highway=secondary|secondary_link then 120
  else if highway=tertiary|tertiary_link then ( if isunpaved then 3 else 40 )
  else if highway=unclassified then ( if isunpaved then 1.6 else 18 )
  else if highway=residential|living_street then ( if isunpaved then 1.6 else 12 )
  else if highway=service then ( if isunpaved then 1.4 else 10 )
  else if highway=cycleway then ( if isunpaved then 1.2 else 9 )
  else if highway=track then
    ( if ispaved then 7
      else if pavedtrack then 7
      else if isunpaved then 1
      else if tracktype=grade2|grade3|grade4|grade5 then 1
      else 1.15 )
  else if highway=path|bridleway then
    ( if ispaved then 7 else if isunpaved then 1 else 1.2 )
  else if highway=footway|pedestrian then ( if isunpaved then 2.5 else 14 )
  else if isunpaved then 1.5
  else 20

assign costfactor = add onewaypenalty add accesspenalty basecost

---context:node
assign initialcost = if highway=traffic_signals then 300 else 0
`,
};
