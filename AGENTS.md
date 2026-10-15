# AGENTS.md

Die verbindlichen Regeln für dieses Repo stehen in **[CLAUDE.md](CLAUDE.md)** und gelten für alle
KI-Agenten gleichermaßen (Claude, Codex, …). Bitte vor jeder Änderung lesen.

Kurzfassung:
- Kein Build-Schritt, reine ES-Module, UI-Texte auf Deutsch.
- Externe Dienste nur über `src/services/`, immer mit Mock-Gegenstück.
- `npm run test:all` muss vor jedem Pull Request grün sein.
- Neue Funktionen bekommen Unit-Tests und einen Schritt im E2E-Test.
