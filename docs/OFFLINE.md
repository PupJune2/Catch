# Catch – Offline-Fahrpläne

Die App kann Verbindungen **ohne Internet** berechnen. Dafür lädt man in der App unter
**Profil → Offline-Fahrpläne** eine Stadt herunter (0,3–1,6 MB). Die Verbindungssuche nutzt das
Paket automatisch, wenn keine Verbindung zum Server besteht, oder auf Wunsch über den Schalter
„Offline“.

Offline gibt es **nur den Fahrplan**: keine Echtzeit, keine Ausfälle, keine Hinweise. Start und
Ziel sind Haltestellen aus dem Paket oder gespeicherte Orte (Zuhause/Arbeit/Favoriten mit
Fußweg). Freie Adresssuche geht nur online.

## Woher die Daten kommen

- **Quelle:** Deutschlandweiter GTFS-Feed von [gtfs.de](https://gtfs.de), täglich aktualisiert,
  Datengrundlage DELFI e.V. Lizenz: **CC BY 4.0**. Der Quellhinweis „Fahrplandaten: DELFI e.V.
  über gtfs.de (CC BY 4.0)“ muss sichtbar bleiben (App-Seite „Offline-Fahrpläne“, Impressum).
- **Bauen:** Der Server lädt den Feed (≈ 270 MB) und schneidet je Stadt einen Kreis aus:
  Halte inkl. Gleis/Steig, Linien, Fahrten der nächsten 14 Tage und Fußwege zwischen nahen
  Halten. Das Ergebnis wird als kompaktes JSON-Paket gespeichert.
- **Aufwand:** Alle 14 Städte brauchen ca. 2–3 Minuten bei höchstens ~600 MB RAM. Der Lauf hat
  niedrige Priorität, die Website merkt davon nichts.
- **Wann:** Montags gegen 3:20 Uhr per systemd-Timer `catch-junify-offline.timer`. Nach dem
  ersten `setup.sh`/`update.sh` startet der erste Lauf sofort im Hintergrund.

## Bedienung auf dem Server

```bash
sudo catch-admin offline          # Stand: Städte, Größe, Gültigkeit, nächster Lauf
```
```bash
sudo catch-admin offline build    # jetzt neu bauen
```
```bash
journalctl -u catch-junify-offline -n 50
```

Dateien:
- `/var/lib/catch-junify/gtfs/de.zip`: Feed. Neu geladen wird nur, wenn er sich geändert hat.
- `/var/lib/catch-junify/offline/`: `index.json` und `<stadt>.json.gz`.
- Abschalten: `OFFLINE_DIR=` (leer) in `/etc/catch-junify/catch.env` setzen, dann
  `sudo systemctl disable --now catch-junify-offline.timer`.

### Eigene Städte

Lege `/etc/catch-junify/offline-regions.json` an. Sie ersetzt die Standardliste aus
`server/src/offline/regions.ts`:

```json
[
  { "id": "muenster", "name": "Münster & Münsterland", "lat": 51.93, "lon": 7.4, "radiusKm": 60 },
  { "id": "osnabrueck", "name": "Osnabrück", "lat": 52.2799, "lon": 8.0472, "radiusKm": 25 }
]
```

Regeln: `id` darf nur `a–z`, `0–9` und `-` enthalten, der Radius muss zwischen 1 und 60 km liegen,
höchstens 30 Städte. Danach `sudo catch-admin offline build` ausführen.

## API

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/v1/offline/regions` | `OfflineRegionsResponse` (Liste mit Größe, Gültigkeit, Stand) |
| GET | `/v1/offline/regions/:id` | `OfflinePackage` als JSON (gzip), max. 30 Downloads/h pro IP |

Paketformat: siehe `OfflinePackage` in `server/src/contract.ts`. Der Routenplaner auf dem Gerät
steckt in `app/src/offline/raptor.ts` (RAPTOR-Algorithmus). Er sucht mehrere Verbindungen mit
möglichst früher Ankunft und wenigen Umstiegen und braucht 0,3–1 Sekunde.

## Grenzen

- Die kostenlose Fassung des Feeds enthält nicht für alle Bahnhöfe Gleisangaben (für Busse meist
  schon). Online kommen Gleise aus der Echtzeit-Auskunft.
- Verbindungen über die Grenze eines Pakets hinaus, etwa von Münster nach Berlin, gehen offline
  nicht.
- Pakete gelten 14 Tage. Die App weist auf veraltete Pakete hin und aktualisiert sie, sobald sie
  online ist.
