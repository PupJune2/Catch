# Architektur

```
┌──────────────────────┐        ┌────────────────────────────────────────────┐
│  App (Expo / React   │ HTTPS  │  Hetzner-Server (Debian) – junify.live     │
│  Native, Android/iOS │───────▶│                                            │
│  + Web-Version)      │  WSS   │  Nginx (HTTPS) ─▶ catch-junify (Node.js)   │
│  • Firebase Login    │◀──────▶│     │ /           │        │               │
│  • Suche / Melden    │        │     ▼             ▼        ▼               │
│  • Live-Tracking     │        │  Web-App     PostgreSQL   Push (FCM/Expo)  │
└─────────┬────────────┘        └────────────────────┬───────────────────────┘
          │ Login                                    │ Fahrplan (gecacht)
          ▼                                          ▼
   Firebase Auth                          MOTIS (Transitous oder eigene Instanz)
```

## Bausteine

| Teil | Technik | Ordner |
|---|---|---|
| App | Expo SDK 58, expo-router, TypeScript, Firebase JS SDK | `app/` |
| API | Node.js 22, Fastify 5, zod, WebSocket | `server/src` |
| Datenbank | PostgreSQL 16 | `server/src/db/migrations` |
| Fahrplan | MOTIS-REST-API | `server/src/transit` |
| Push | Firebase Cloud Messaging direkt oder Expo Push Service | `server/src/services/notifier.ts` |
| Betrieb | systemd + Nginx + Certbot (`setup.sh`/`update.sh`) | `deploy/debian/` |
| Android-Build | GitHub Actions (expo prebuild + Gradle) | `.github/workflows/` |

Der gemeinsame Datenvertrag zwischen App und Server steht in
[`server/src/contract.ts`](../server/src/contract.ts) (Kopie in `app/src/api/contract.ts`).

## Ablauf: Jemand meldet eine Kontrolle

1. **App:** „Melden“ → Standort → `GET /v1/report-candidates` liefert die Fahrten, die gerade
   in der Nähe sind („In welcher Linie bist du?“).
2. **App:** Fahrt wählen → `GET /v1/trip` liefert alle Halte + **geschätzte Position**
   (letzter/nächster Halt anhand der Uhrzeit inkl. Verspätung). Die App wählt beide vor –
   der Nutzer muss meist nur noch bestätigen.
3. **App:** `POST /v1/reports` mit Linie, Fahrt, Halten, Merkmalen (z. B. „in Zivil“).
4. **Server:**
   - prüft Login, Limits (1×/Linie/10 Min, 20/Tag),
   - lädt die echte Fahrt und **validiert Linie und Halte** (gefälschte Haltestellen → 400),
   - speichert die Meldung,
   - schickt sie per WebSocket an alle, die die Linie gerade ansehen,
   - sucht passende **Live-Trackings** und schickt Alarm per WebSocket (Popup + Ton) und Push
     (FCM direkt an die Android-App oder über den Expo-Push-Dienst).

## Ablauf: Jemand sucht seine Verbindung

1. `GET /v1/stops/search` (Von/Nach) → `GET /v1/journeys` – wie beim DB Navigator.
2. Jeder Fahrtabschnitt kommt mit `summary` zurück: `calm` (ruhig), `frequent` (oft
   kontrolliert, ≥ 5 Meldungen in 30 Tagen) oder `active` (Meldung in der letzten Stunde).
3. Tippen auf eine Linie → `GET /v1/lines/:lineKey/stats`:
   - Anzahl Meldungen, letzte Meldung
   - **durchschnittliche Uhrzeit** (zirkulärer Mittelwert – 23:50 und 00:10 ergeben 00:00)
   - **Stoßzeiten** (die 90-Minuten-Fenster mit den meisten Meldungen)
   - **Hotspots**: zwischen welchen Halten am häufigsten kontrolliert wird
     (beide Fahrtrichtungen zusammengefasst)
   - Verteilung nach Stunde und Wochentag, Richtungen
   - ein Satz Zusammenfassung, z. B. *„Zwei Stoßzeiten: 07:15–08:45 und 17:00–18:15 Uhr.
     Hotspot: zwischen Moritzplatz und Kottbusser Tor (27×).“*
4. Auf Wunsch: Liste aller Meldungen (`GET /v1/lines/:lineKey/reports`).

## Live-Tracking

- Aus einer Verbindung: ein Tracking pro Fahrtabschnitt, Zeitfenster
  *Abfahrt − 30 Min … Ankunft + 5 Min*, inkl. aller Halte des eigenen Abschnitts.
- Aus „Linie + Uhrzeit“: Abfahrt wählen → Fenster *Abfahrt − 30 Min … + 90 Min*.
- Abgleich (`matchTracking`):
  - gleiche Linie und Richtung → Alarm („Kontrolle auf U8“),
  - liegt die Meldung auf dem eigenen Abschnitt → hervorgehobener Alarm
    („Kontrolle auf deinem Abschnitt“),
  - Gegenrichtung nur, wenn „beide Richtungen“ gewählt ist.

## Linien eindeutig erkennen

`lineKey = <verkehrsmittel>:<linienname>:<betreiber>`, z. B.
`subway:u8:berliner-verkehrsbetriebe`, `bus:100:hamburger-hochbahn`.

- Der Betreiber trennt gleichnamige Linien verschiedener Städte.
- Bewusst **nicht** die GTFS-`route_id` – die ändert sich bei Fahrplanwechseln, und dann
  wären alle Statistiken weg.
- Haltestellen werden über die bundesweite **DHID** (`de:11000:900013102`) verglichen, damit
  dieselbe Haltestelle aus unterschiedlichen Datenquellen zusammenpasst.

## Vertrauen & Missbrauchsschutz

| Maßnahme | Wo |
|---|---|
| Login Pflicht zum Melden, Abstimmen, Tracken | `auth/auth.ts` |
| Server berechnet Linienschlüssel selbst; Fahrt & Halte werden gegen echte Daten geprüft | `services/reports.ts` |
| 1 Meldung pro Linie / 10 Min, max. 20 / Tag, max. 10 Trackings | `services/reports.ts`, `trackings.ts` |
| „Noch da 👍 / Weg 👎“-Abstimmung; ≥ 3 mehr Ablehnungen als Bestätigungen → ausgeblendet | `voteReport` |
| Vertrauensstufe 0–3 aus erhaltenen Bestätigungen | `services/users.ts` |
| Sperren von Konten (`users.banned`) | Datenbank |
| Rate-Limit pro IP (300/Min, Melden 10/Min) | `app.ts` |

## Datenschutz & Recht

- **Kein Freitext, keine Fotos** – nur vordefinierte Merkmale. Kontrolleure sind Menschen
  mit Persönlichkeitsrechten; Beschreibungen einzelner Personen gehören nicht in die App.
- Es wird **kein GPS-Verlauf** gespeichert – nur die gemeldeten Haltestellen.
- Konto löschen jederzeit möglich; Meldungen werden dabei anonymisiert.
- Meldungen werden nach 365 Tagen gelöscht, abgelaufene Trackings nach 1 Tag.
- Für den Start benötigst du eine **Datenschutzerklärung** und ein **Impressum**
  (Pflicht in DE) – vor Veröffentlichung im App Store / Play Store.
- Die App sollte klar kommunizieren, dass man mit gültigem Ticket fährt. App-Stores
  lehnen Apps ab, die erkennbar zu Straftaten anleiten – Catch positioniert sich als
  Transparenz- und Community-App. Vor dem öffentlichen Start eine kurze rechtliche
  Prüfung einplanen.
