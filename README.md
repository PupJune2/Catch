<p align="center">
  <img src="app/assets/images/icon.png" width="96" alt="Catch logo" />
</p>

<h1 align="center">Catch</h1>

<p align="center"><b>Know what's happening on your line.</b><br/>
A community app for buses, trams, U-Bahn, S-Bahn and trains in Germany – passengers share delays,
cancellations, crowding and disruptions, everyone else sees them live.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only"></a>
  <a href="NOTICE.md"><img src="https://img.shields.io/badge/attribution-required-orange" alt="Attribution required"></a>
  <a href="https://junify.live"><img src="https://img.shields.io/badge/website-junify.live-c7e8a5" alt="Website"></a>
</p>

<p align="center"><b>Created by PupJune2</b> · © 2026 PupJune2 · AGPL-3.0 with attribution terms (<a href="NOTICE.md">NOTICE.md</a>) · the name “Catch” and the logo are not licensed (<a href="TRADEMARKS.md">TRADEMARKS.md</a>)</p>

---

## Features

| | |
|---|---|
| 🔎 **Journey search** | Stops, addresses and places. Every line in a result shows its current status – *quiet*, *frequent reports* or *just reported* – plus platforms and change times. Departure boards per stop. |
| 🔁 **Change rides** | Change too tight? Tap a ride, pick an earlier or later one between the same stops, and Catch rebuilds the rest of the connection. |
| 🚨 **Report in seconds** | Delay, cancellation, crowding, disruption or ticket check. Catch suggests the line and the last/next stop from your location. Fixed tags only – no free text, no photos. |
| 📡 **Live alerts** | Track a line or a whole connection and get a pop-up with sound and a push notification when something is reported on your section. |
| 🧭 **Commute** | Save a daily route; Catch watches it with live data and tells you when to leave. |
| 📊 **Line insights** | Reports over 7/30/90 days, rush hours, hotspots between stops and a short forecast. |
| 🗺️ **Map** | All recent reports on a map, filterable by type. |
| 📞 **On-demand buses** | Rufbus, AST and TaxiBus lines are marked “book ahead”. |
| 📴 **Offline** | Download a city's timetable and plan journeys without internet (Android). |
| 🎓 **Help & tutorials** | Short animated walkthroughs for every feature. English and German. |

Catch is about the journey, not about people: reports describe the situation, never persons.
Always travel with a valid ticket.

## How it works

```
 App (Expo / React Native)            Server (Node.js, Fastify)          Open data
 Android, web app (PWA)   ── HTTPS ─▶ PostgreSQL, WebSockets      ──▶   Transitous (MOTIS)
                          ◀─ live ──  push (Firebase Cloud Messaging)    timetables, real time,
 Website (static HTML)                                                   geocoding
```

- **Timetables, real time and routing** come from [Transitous](https://transitous.org), a
  community-run MOTIS instance with open data from many transport authorities.
- **Offline timetables** are built weekly from the DELFI dataset (GTFS) and routed on the device.
- **Accounts** use Firebase Authentication; the server verifies every token. Push goes through
  Firebase Cloud Messaging.
- **Community data** (reports, confirmations, trackings) lives in PostgreSQL on the server.

## Repository layout

```
app/      Mobile and web app (Expo / React Native, TypeScript)   → app/README.md
server/   API (Node.js, Fastify, PostgreSQL, TypeScript)         → server/README.md
website/  Static website, admin page, map page
deploy/   setup.sh / update.sh for a Debian server
docs/     Architecture, API, admin, offline timetables, tutorials
```

More: [Architecture](docs/ARCHITEKTUR.md) · [API](docs/API.md) · [Routing data](docs/MOTIS.md) ·
[Offline timetables](docs/OFFLINE.md) · [Admin area](docs/ADMIN.md) · [Firebase setup](docs/FIREBASE.md) ·
[Tutorials](docs/TUTORIALS.md)

## Getting started (local)

Requirements: **Node.js 24**, **Docker** (for PostgreSQL).

1. Database:

```bash
docker run -d --name catch-db -e POSTGRES_USER=catch -e POSTGRES_PASSWORD=catch -e POSTGRES_DB=catch -p 5432:5432 postgres:16-alpine
```

2. Server – copy the example settings and set `AUTH_MODE=dev` in `server/.env` (developer login, no Firebase needed):

```bash
cd server && npm install && cp .env.example .env
```

```bash
npm run dev
```

3. Optional demo reports (second terminal, in `server/`):

```bash
npm run seed:demo
```

4. App – copy the example settings; for a real login, add the web config of **your own** Firebase project:

```bash
cd app && npm install && cp .env.example .env
```

```bash
npx expo start
```

Press `w` for the browser, or open it in a development build. Details on builds and push
notifications: [app/README.md](app/README.md).

## Deployment

`deploy/debian/setup.sh` sets up a fresh Debian 12/13 server in one go: Node.js, PostgreSQL,
nginx with Let's Encrypt, systemd services and timers (offline timetables, backups, monitoring),
plus the `catch-admin` command. Updates: `deploy/debian/update.sh`. All settings and secrets live
only on the server (`/etc/catch-junify/catch.env`), never in this repository.

## Data sources

- **Timetables, real time, geocoding:** [Transitous](https://transitous.org) –
  [all data sources](https://transitous.org/sources/), used under their
  [usage policy](https://transitous.org/api/).
- **Offline timetables:** DELFI e.V. via [gtfs.de](https://gtfs.de), licence CC BY 4.0.
- **Map and places:** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright);
  map tiles by [OpenFreeMap](https://openfreemap.org), © OpenMapTiles.

Full credits and third-party notices: [NOTICE.md](NOTICE.md).

## License, attribution and trademarks

**Catch was created, designed and developed by PupJune2. © 2026 PupJune2 – all rights not
expressly granted are reserved.**

The source code is licensed under the **GNU Affero General Public License v3.0 only**
([LICENSE](LICENSE)) with **additional terms under section 7** ([NOTICE.md](NOTICE.md)). Those two
files are binding; in short:

| You may | You must | You must not |
|---|---|---|
| read, use, modify and share the code | publish the **complete source code** of every modified version under the same licence – also if it only runs as a server or web app | **remove copyright or licence notices**, including the header of each source file |
| | show **“Based on Catch by PupJune2 – https://junify.live – licensed under AGPL-3.0”** visibly in every app or website based on Catch, with a link to its source code | present the code or the app as **your own work** |
| | **mark modified versions** as modified (notices with date in the changed files) | call a modified version **“Catch”**, use the **logo**, or present it as official or endorsed by PupJune2 |
| | keep **LICENSE, NOTICE.md and TRADEMARKS.md** in every copy | use the names **PupJune2** or **junify** for advertising |

- **Name and logo:** “Catch”, similar names, the ghost logo, icons and marketing graphics are not
  covered by the licence ([TRADEMARKS.md](TRADEMARKS.md)).
- **No warranty:** provided without any warranty (AGPL sections 15–16).
- **Contributions:** accepted only if you grant PupJune2 the right to also use them under other
  licences ([NOTICE.md](NOTICE.md#contributions)).
- **Violations:** anyone who breaks these terms automatically loses all rights under the licence
  (AGPL section 8).

## Kurz auf Deutsch

**Catch** ist eine Community-App für Bus und Bahn in Deutschland: Fahrgäste melden Verspätungen,
Ausfälle, Überfüllung und Störungen je Linie, alle anderen sehen sie live. Entwickelt von
**PupJune2**, © 2026. Lizenz: **AGPL-3.0** mit Pflicht zur Namensnennung
(„Based on Catch by PupJune2 – https://junify.live – licensed under AGPL-3.0“), veränderte
Versionen müssen ihren Quellcode veröffentlichen und dürfen weder „Catch“ heißen noch das Logo
verwenden. Verbindlich sind [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) und
[TRADEMARKS.md](TRADEMARKS.md).
