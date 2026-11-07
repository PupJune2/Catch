# Catch – Server

Node.js 22 + Fastify + PostgreSQL. API-Referenz: [docs/API.md](../docs/API.md),
Aufbau: [docs/ARCHITEKTUR.md](../docs/ARCHITEKTUR.md).

## Lokal starten

Voraussetzungen: Node.js 22+, Docker (für die Datenbank).

1. Datenbank starten:

```bash
docker run -d --name catch-db -e POSTGRES_USER=catch -e POSTGRES_PASSWORD=catch -e POSTGRES_DB=catch -p 5432:5432 postgres:16-alpine
```

2. Abhängigkeiten & Konfiguration:

```bash
npm install
cp .env.example .env
```

Für die Entwicklung in `.env` `AUTH_MODE=dev` setzen – dann akzeptiert der Server zusätzlich
`Authorization: Bearer dev:<name>` (die App bietet dafür einen „Entwickler-Login“).

3. Starten (legt Tabellen automatisch an, lädt bei Änderungen neu):

```bash
npm run dev
```

4. Optional: realistische Demo-Meldungen für Berliner Linien (U8, U1, U2, U7, M41):

```bash
npm run seed:demo
```

Wieder entfernen:

```bash
npm run seed:demo -- --clear
```

Test:

```bash
curl "http://localhost:8080/v1/stops/search?q=Alexanderplatz"
```

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Auto-Reload |
| `npm test` | Unit-Tests (Statistik, Linien-Erkennung, Tracking-Abgleich, MOTIS-Umwandlung) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run build` / `npm start` | Produktions-Build |
| `npm run migrate` | Datenbank-Migrationen manuell ausführen |
| `npm run sync-contract` | `src/contract.ts` in die App kopieren |

Alle Skripte lesen automatisch die Datei `.env` im Server-Ordner (falls vorhanden).

## Ordner

```
src/
  index.ts            Start, Aufräum-Job, sauberes Herunterfahren
  app.ts              Fastify-Setup, Fehlerbehandlung, Routen
  config.ts           Umgebungsvariablen (validiert)
  contract.ts         Datenformate für App ↔ Server
  auth/auth.ts        Firebase-Token-Prüfung (+ Dev-Login)
  db/                 Verbindung, Migrationen, Demo-Daten
  transit/            MOTIS-Client, Umwandlung, Linienschlüssel
  services/
    reports.ts        Melden, Abstimmen, Listen, Zusammenfassungen
    stats.ts          Ø-Uhrzeit, Stoßzeiten, Hotspots, Text-Zusammenfassung
    trackings.ts      Live-Tracking + Abgleich mit neuen Meldungen
    notifier.ts       WebSocket-Hub + Expo-Push
    users.ts          Konto, Geräte, Vertrauensstufe
  routes/             HTTP- und WebSocket-Endpunkte
test/                 Vitest
```
