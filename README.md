# veloai

Rundkurs-Planer für **Rennrad**, **Gravel** und **Hardcore-Gravel**. Start und Kilometer wählen,
optional eine Startrichtung per Kompass, und veloai plant eine Runde, deren Belag zum Rad passt.

- **Rennrad:** nur Asphalt, mit Belagprüfung und Warnung bei unsicheren Abschnitten
- **Gravel:** Wirtschaftswege und ruhige Nebenstraßen
- **Hardcore-Gravel:** Schotter, Sand und Trails – Asphalt und Straßen werden um jeden Preis gemieden
- **Kompass:** Startrichtung in 15°-Schritten oder „egal“
- **Mehrere Varianten:** veloai rechnet mehrere Kandidaten parallel, bewertet sie und zeigt die besten zum Durchblättern
- Zwischenziele (bis zu 3), Modus „Heißer Tag“, Höhenprofil, Belaganalyse, GPX-Export
- Keine Anmeldung, keine API-Keys: BRouter, OpenStreetMap, Photon

## Lokal starten

```bash
npm start            # http://127.0.0.1:8080
                     # Testdaten ohne Netz: http://127.0.0.1:8080/?mock=1
```

## Tests

```bash
npm test             # Unit-Tests
npm install          # einmalig für den Browser-Test (Playwright)
npx playwright install chromium
npm run test:e2e     # Browser-Ablauf mit Testdaten + Screenshots
```

Die Tests laufen auch automatisch bei jedem Push (GitHub Actions).

## Veröffentlichen

GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / root*.
Kein Build nötig, die Seite wird direkt so ausgeliefert, wie sie im Repo liegt.

## Lizenz der Daten

Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Leaflet © Vladimir Agafonkin (BSD-2-Clause, siehe `vendor/leaflet/LICENSE`).
