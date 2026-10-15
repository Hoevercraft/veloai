# veloai – Hinweise für KI-Assistenten (Claude, Codex & Co.)

Rundkurs-Planer für Rennrad, Gravel und Hardcore-Gravel. Kernversprechen:
**Start + Kilometer → Rundtour, deren Belag zum Rad passt.**
Rennrad nur auf Asphalt, Hardcore-Gravel meidet Asphalt und Straßen um jeden Preis.

## Grundregeln

- **Kein Build-Schritt.** Reine ES-Module, direkt von GitHub Pages ausgeliefert. Keine Frameworks, kein Bundler.
- **Alle Texte in der Oberfläche auf Deutsch**, kurz und in normaler Groß-/Kleinschreibung.
- **Externe Dienste nur über `src/services/`.** Jeder Dienst hat ein Gegenstück in `src/services/mock.js`.
  Neue Dienste brauchen ebenfalls eine Mock-Variante, sonst sind sie offline nicht testbar.
- **Planungslogik ist DOM-frei** (`src/core/`, `src/routing/`) und wird mit Unit-Tests abgedeckt.
- **Jedes bedienbare Element hat ein `data-testid`.**
- Leaflet liegt in `vendor/leaflet/` (Version 1.9.4) – nicht vom CDN laden.

## Befehle

```bash
npm start              # Server auf http://127.0.0.1:8080  (Testdaten: /?mock=1)
npm test               # Unit-Tests (node:test), kein Netz nötig
npm run test:e2e       # Browser-Test mit Testdaten, legt Screenshots in tests/e2e/screenshots/ ab
npm run test:all       # beides
```

## Arbeitsweise bei neuen Anfragen

1. Anfrage in **prüfbare Akzeptanzkriterien** übersetzen und mit Jan abstimmen, wenn etwas unklar ist.
2. Logik zuerst als reine Funktion + Unit-Test, dann UI.
3. E2E-Test um einen Schritt für das neue Verhalten erweitern.
4. `npm run test:all` muss grün sein. Screenshots ansehen und selbst beurteilen, ob das Ergebnis die Anfrage erfüllt.
5. Arbeit auf einem eigenen Branch, Pull Request mit Kriterien, Testergebnis und Screenshots.
6. **Version erhöhen** in `src/version.js` (VERSION + RELEASED) und `package.json` – ein Unit-Test prüft,
   dass beide übereinstimmen. Die Nummer steht unten im Panel, damit Jan sieht, ob die Seite aktuell ist.

## Architektur

```
index.html               Markup, alle Bedienelemente
css/app.css              Gestaltung (Tokens oben in :root)
src/main.js              verbindet Zustand, Dienste, Karte und Panel
src/app/                 Oberfläche: state, map, compass, widgets (Höhenprofil, Belag, GPX, Ortssuche)
src/core/geo.js          Geo-Mathematik, Koordinaten immer [lon, lat]
src/routing/profiles.js  BRouter-Profile je Radtyp + Radtyp-Metadaten
src/routing/loopgen.js   Kandidaten-Layouts (Kreisform, Drehsinn, Radius, Kompass-Rotation)
src/routing/scoring.js   Bewertung: Distanz, Belag, Doppelbefahrung, Startrichtung
src/routing/planner.js   Ablauf: Pool laden → Kandidaten parallel routen → bewerten → nachschärfen
src/routing/surface.js   Belag aus BRouter-Segmenten, Warnungen, Farben
src/routing/backtrack.js entfernt Hin-und-zurück-Stiche
src/services/            brouter, overpass, geocode (Photon/Nominatim), mock
tests/unit/              node:test
tests/e2e/smoke.mjs      Playwright-Ablauf mit ?mock=1
```

## Routing-Algorithmus in Kürze

Statt einer einzigen Runde mit Distanz-Wiederholungen werden **6 Kandidaten parallel** erzeugt
(unterschiedliche Kreisform, Drehsinn, Radius), auf passende OSM-Wege eingerastet und mit BRouter
geroutet. Jede Route wird bereinigt und bewertet (Gewichte je Radtyp in `scoring.js`).
Die zwei besten werden bei Bedarf mit korrigiertem Radius erneut gerechnet. Ergebnis: beste Route
plus bis zu 4 unterschiedliche Alternativen zum Durchblättern, ohne neue Serveranfragen.

Kompass = **Startrichtung**: Das Layout wird so gedreht, dass die Runde grob in diese Richtung losfährt.
Die Richtung fließt mit 12 % Gewicht in die Bewertung ein, die Route bleibt sonst frei.

## Externe Dienste (alle ohne API-Key)

brouter.de (Routing), overpass-api.de / overpass.kumi.systems (Wegpunkt-Kandidaten),
photon.komoot.io (Ortssuche), nominatim.openstreetmap.org (Koordinate → Name),
tile.openstreetmap.org / opentopomap.org (Karten). Öffentliche Server schonen: max. 3 parallele Anfragen.
