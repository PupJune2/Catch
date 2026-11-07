# Fahrplandaten für ganz Deutschland

Catch braucht Haltestellen, Abfahrten, Verbindungen und Fahrtverläufe – und zwar für
**alle** Verkehrsmittel (Bus, Tram, U-Bahn, S-Bahn, Regional- und Fernverkehr).

## Gewählte Lösung: MOTIS

[MOTIS](https://github.com/motis-project/motis) ist ein Open-Source-Routing-Server. Er liest
offene Fahrplandaten (GTFS) und bietet eine REST-API für Haltestellensuche, Abfahrten,
Verbindungen und Fahrten – inklusive Echtzeit (GTFS-RT).

Der Catch-Server spricht nur mit dieser API (`server/src/transit/motis.ts`). Woher MOTIS
die Daten hat, ist austauschbar:

| Phase | `MOTIS_URL` | Vorteile | Nachteile |
|---|---|---|---|
| **Start / Test** | `https://api.transitous.org` | Sofort nutzbar, ganz Deutschland + Europa, Echtzeit | Gemeinschaftsprojekt mit Nutzungsrichtlinie, keine Garantie |
| **Produktion** | `http://motis:8080` (eigener Server) | Volle Kontrolle, keine Limits | Eigener Server mit viel RAM, Daten selbst aktualisieren |

### Warum nicht die DB-API (wie DB Navigator)?

Die inoffiziellen DB-Schnittstellen (`db-vendo-client`, `v6.db.transport.rest`) werden
laut ihren Entwicklern „willkürlich blockiert“ und sind sehr unzuverlässig geworden. Sie
dürfen streng genommen auch nur mit Erlaubnis der DB genutzt werden. MOTIS mit offenen
Daten ist die stabilere und rechtlich saubere Grundlage.

## Transitous verantwortungsvoll nutzen

[Transitous](https://transitous.org) ist ein ehrenamtliches Projekt. Bitte:

- die [Nutzungsrichtlinie](https://transitous.org/api/) lesen,
- einen erkennbaren `TRANSIT_USER_AGENT` mit Kontaktmöglichkeit setzen,
- bei vielen Nutzern auf eine eigene Instanz umsteigen (oder das Projekt unterstützen).

Der Catch-Server **cacht** alle Antworten (Haltestellensuche 6 h, Abfahrten 30 s,
Verbindungen/Fahrten 60 s) und bündelt identische gleichzeitige Anfragen, um die Last klein
zu halten.

## Eigene MOTIS-Instanz (Phase 2)

### Daten

- **Fahrpläne (GTFS) für Deutschland:** der bundesweite Datensatz von **DELFI**
  (über [opendata-oepnv.de](https://www.opendata-oepnv.de), kostenlose Registrierung) oder
  aufbereitete Feeds von [gtfs.de](https://gtfs.de). Enthält Nah-, Regional- und Fernverkehr.
- **Straßennetz (für Fußwege/Umstiege):** OpenStreetMap-Auszug Deutschland von
  [Geofabrik](https://download.geofabrik.de/europe/germany.html) (`germany-latest.osm.pbf`).
- **Echtzeit (optional):** GTFS-RT-Feeds, z. B. von gtfs.de oder regionalen Verbünden.

### Server-Größe

Der Import für ganz Deutschland inkl. Straßennetz ist speicherhungrig. Plane einen
**eigenen Server mit viel RAM** ein (z. B. Hetzner Dedicated/CCX mit ≥ 32 GB) und teste
zuerst mit einem Bundesland, um den Bedarf zu messen.

### Installation (Kurzfassung, nach der offiziellen Anleitung)

```bash
mkdir -p /opt/motis && cd /opt/motis
wget https://github.com/motis-project/motis/releases/latest/download/motis-linux-amd64.tar.bz2
tar xf motis-linux-amd64.tar.bz2
wget https://download.geofabrik.de/europe/germany-latest.osm.pbf
# GTFS-Datei(en) hierher legen, z. B. delfi-gtfs.zip
./motis config germany-latest.osm.pbf delfi-gtfs.zip
./motis import
./motis server
```

`motis server` lauscht standardmäßig auf Port 8080 – auf deinem Server ist der vom
Hauptportal belegt, also in der `config.yml` von MOTIS einen freien Port wählen (z. B. 8100),
als systemd-Dienst betreiben und in `/etc/catch-junify/catch.env`
`MOTIS_URL=http://127.0.0.1:8100` setzen (danach `systemctl restart catch-junify`).
Den Port **nicht** öffentlich freigeben.

Fahrpläne ändern sich ständig: Den Import regelmäßig (z. B. wöchentlich per cron) mit
frischen GTFS-Daten wiederholen. Der Catch-Linienschlüssel hängt bewusst **nicht** an
GTFS-IDs, damit die Statistiken bei Fahrplanwechseln erhalten bleiben.

## Bekannte Grenzen

- Dieselbe Linie kann in zwei Datenquellen mit leicht anderem Betreibernamen auftauchen
  (z. B. „DB Regio AG“ vs. „DB Regio AG Nordost“). Live-Trackings erkennen das über die
  bundesweit eindeutigen Haltestellen-IDs (DHID) trotzdem; die Statistik wird in dem Fall
  auf zwei Linienschlüssel verteilt. Lösung bei Bedarf: Betreiber-Aliase in
  `server/src/transit/lineKey.ts`.
- Echtzeitdaten gibt es nicht für jede Region.
