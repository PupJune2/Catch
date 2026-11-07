# Hilfe & Tutorials

In der App unter **Profil → Hilfe & Tutorials** (`/help`). Jede Frage („Kann ich …?“) hat eine
kurze Antwort, den Fundort und eine Animation (`/tutorial/<id>`).

## Aufbau

| Datei | Inhalt |
|---|---|
| `app/src/tutorials/types.ts` | Typen: `Tutorial`, `TutorialStep`, `SceneProps` |
| `app/src/tutorials/mock.tsx` | Bausteine für das Mini-Telefon (300 × 600 Punkte): Karten, Knöpfe, Tab-Leiste, Sheet, Toast, `Appear`, `Pulse`, `Typing` … |
| `app/src/tutorials/Player.tsx` | Abspielen: Finger, Tipp-Welle, Bildunterschrift, Steuerung |
| `app/src/tutorials/scenes/*.tsx` | Die einzelnen Tutorials (Vorlage: `changeRides.tsx`) |
| `app/src/tutorials/index.ts` | Liste aller Tutorials (Reihenfolge, Kategorien) |
| `app/src/app/help.tsx`, `app/src/app/tutorial/[id].tsx` | Bildschirme |

## Neues Tutorial

1. Datei unter `scenes/` anlegen (am besten `changeRides.tsx` kopieren).
2. Layout als Rechtecke in `R` festlegen – daraus werden die Finger-Ziele (`center(R.knopf)`).
3. `Scene` zeigt für jeden Schritt den Zustand **vor** dem Tippen; das Ergebnis erscheint im nächsten Schritt.
4. Texte immer zweisprachig (`{ de, en }`), Bildunterschriften kurz und als Anweisung („Tippe auf …“).
5. In `index.ts` bzw. einer der Gruppen-Dateien eintragen.

## Robustheit

- **Neuladen:** Der Schritt steht in der URL (`?step=3`); alle Animationen starten im Zustand des
  aktuellen Schritts – nach einem Neuladen geht es ohne Flackern genau dort weiter.
- **Aufräumen:** Animationen und Timer werden beim Schrittwechsel und beim Verlassen gestoppt.
- **Bewegung reduzieren** (Systemeinstellung): kein Autoplay, der Finger springt direkt zum Ziel,
  weiter geht es per Knopf.
- **Angesehen:** wird nur auf dem Gerät gespeichert (`catch.tutorials.seen`), für den „neu“-Hinweis im Profil.
