# Catch – API-Referenz

Basis-URL: `https://junify.live` (lokal: `http://localhost:8080`).
Alle Typen stehen in [`server/src/contract.ts`](../server/src/contract.ts).

**Auth:** `Authorization: Bearer <Firebase ID-Token>`.
Im lokalen Entwicklungsmodus (`AUTH_MODE=dev`) geht auch `Bearer dev:<name>`.

**Sprache:** Header `Accept-Language: en` (Standard) oder `de`. Fehlermeldungen, die
Linien-Zusammenfassung (`insight`) und Alarm-Texte kommen in dieser Sprache. Der Server
merkt sich die zuletzt genutzte Sprache am Konto – Push-Alarme kommen in dieser Sprache.

**Fehler:** HTTP-Status ≥ 400 mit Body `{ "error": "code", "message": "anzeigbare Meldung" }`.

## Fahrplan (öffentlich)

| Methode | Pfad | Parameter | Antwort |
|---|---|---|---|
| GET | `/v1/stops/search` | `q` (min. 2 Zeichen) | `{ stops: Stop[] }` |
| GET | `/v1/stops/nearby` | `lat`, `lon`, `radius?` (m, Std. 800) | `{ stops: Stop[] }` |
| GET | `/v1/departures` | `stopId`, `time?` (ISO), `n?` (Std. 40) | `{ stop: Stop \| null, departures: Departure[] }` |
| GET | `/v1/journeys` | `from`, `to` (Stop-IDs), `time?`, `arriveBy?` (`true`/`false`), `cursor?` | `JourneysResponse` |
| GET | `/v1/journeys/leg-options` | `from`, `to` (Stop-IDs eines Abschnitts), `time` (planmäßige Abfahrt), `before?` (Min., Standard 120), `after?` (Min., Standard 90) | `LegOptionsResponse` – Direktfahrten ohne Umstieg zwischen den beiden Haltestellen, nach Abfahrt sortiert ("Fahrten ändern" in der App) |
| GET | `/v1/trip` | `id` (tripId) | `Trip` |
| GET | `/v1/report-candidates` | `lat`, `lon` | `{ departures: Departure[] }` – Fahrten, die gerade in der Nähe sind (für „Melden“ im Fahrzeug) |

Abfahrten, Verbindungsabschnitte und Fahrten enthalten ein `summary: ReportSummary`
mit der aktuellen Meldungslage der Linie.

## Orte & Karte

| Methode | Pfad | Auth | Parameter | Antwort |
|---|---|---|---|---|
| GET | `/v1/places/search` | – | `q` (≥ 2 Zeichen), `lat?`, `lon?` (Treffer in der Nähe zuerst) | `{ places: Place[] }` – Haltestellen, Adressen (Straße + Nr., PLZ/Ort), Orte |
| GET | `/v1/places/reverse` | – | `lat`, `lon` | `{ place: Place \| null }` (z. B. für „Mein Standort“) |
| GET | `/v1/map` | – | `minLat`, `minLon`, `maxLat`, `maxLon`, `minutes?` (Std. 120), `kind?` | `MapResponse` – Haltestellen (nur bis ca. 6 × 6 km, sonst `stopsHidden`) + aktuelle Hinweise |

`Place.id` ist bei Haltestellen die Stop-ID, sonst `geo:<lat>,<lon>`; beides geht direkt als
`from`/`to` an `/v1/journeys` (dazu `fromName`/`toName` für die Beschriftung des Fußwegs).
Gleise/Steige: `Departure.track`/`plannedTrack`, `Leg.fromTrack`/`toTrack` (+ `…PlannedTrack`),
`Stopover.track`/`plannedTrack`; weicht `track` vom geplanten ab, wurde das Gleis geändert.
`Leg.geometry` enthält den Streckenverlauf (kodierte Polyline) für die Karte.

## Offline-Fahrpläne

Siehe [OFFLINE.md](OFFLINE.md): `GET /v1/offline/regions`, `GET /v1/offline/regions/:id`.

## Linien & Meldungen

| Methode | Pfad | Auth | Body / Parameter | Antwort |
|---|---|---|---|---|
| GET | `/v1/lines/:lineKey/stats` | – | `days?` (7/30/90, Std. 30), `directionId?`, `kind?` | `LineStats` (inkl. `kind`, `byKind`) |
| GET | `/v1/lines/:lineKey/reports` | optional | `days?`, `limit?` (≤ 200), `before?` (ISO), `kind?` | `{ reports: Report[] }` |
| GET | `/v1/stats/public` | – | – | `{ reports24h, reports7d, lines24h, updatedAt }` (für die Website, 60 s gecacht) |
| GET | `/v1/reports/recent` | optional | `lat?`, `lon?`, `radiusKm?` (Std. 30), `minutes?` (Std. 60), `kind?` | `{ reports: Report[] }` |
| POST | `/v1/reports` | ✅ | `CreateReportBody` | `Report` (201) |
| POST | `/v1/reports/:id/vote` | ✅ | `{ value: 1 \| -1 }` (1 = „stimmt noch“, -1 = „erledigt / stimmt nicht“) | `Report` |
| POST | `/v1/reports/:id/flag` | ✅ | `{ reason: "WRONG" \| "SPAM" \| "INAPPROPRIATE" \| "OTHER" }` – „Inhalt melden“ | 204 |
| DELETE | `/v1/reports/:id` | ✅ | – (nur eigene, innerhalb 15 Min.) | 204 |

**Arten (`kind`)**: `DELAY` (Verspätung), `CANCELLED` (Ausfall/Ersatzverkehr), `CROWDED` (Überfüllung),
`DISRUPTION` (Störung/Defekt), `CHECK` (Fahrkartenkontrolle). `CreateReportBody.kind` fehlt bei alten
App-Versionen → `CHECK`. Erlaubte Merkmale je Art: `TAGS_BY_KIND` in `server/src/contract.ts`
(passt ein Merkmal nicht zur Art → 400 `invalid_input`). `byKind` in `LineStats` zählt immer alle Arten
(für Filter-Chips), `insight` ist auf die gewählte Art formuliert.

Regeln gegen Missbrauch (Server): max. 1 Meldung pro Linie **und Art** alle 10 Min. pro Nutzer,
max. 20 Meldungen pro Tag, keine Abstimmung über und keine Markierung von eigenen Meldungen.
Ab **3 Markierungen** verschiedener Nutzer wird eine Meldung automatisch ausgeblendet
(`sudo catch-admin flags` zeigt markierte Inhalte, `catch-admin unhide <ID>` blendet wieder ein).

## Live-Tracking

| Methode | Pfad | Auth | Body | Antwort |
|---|---|---|---|---|
| GET | `/v1/trackings` | ✅ | – | `{ trackings: Tracking[] }` (aktive + kommende) |
| POST | `/v1/trackings` | ✅ | `CreateTrackingBody` | `Tracking` (201) |
| DELETE | `/v1/trackings/:id` | ✅ | – | 204 |
| GET | `/v1/alerts` | ✅ | – | `{ alerts: TrackingAlert[] }` (letzte 24 h) |

`CreateTrackingBody.kinds?` legt fest, bei welchen Arten alarmiert wird (leer/fehlt = alle).
Sobald jemand eine passende Meldung abgibt, bekommt der Nutzer
1. eine Push-Benachrichtigung (Expo Push → FCM/APNs) und
2. – falls die App offen ist – eine WebSocket-Nachricht `{ type: "alert" }` → Popup + Ton.

## Pendler-Modus (gespeicherte Strecken)

| Methode | Pfad | Auth | Body | Antwort |
|---|---|---|---|---|
| GET | `/v1/commutes` | ✅ | – | `{ commutes: Commute[] }` (inkl. `plan` des laufenden/heutigen Termins, `nextAt`, `watching`) |
| POST | `/v1/commutes` | ✅ | `CreateCommuteBody` | `Commute` (201), max. 5 je Konto → 409 `too_many_commutes` |
| PATCH | `/v1/commutes/:id` | ✅ | `UpdateCommuteBody` (alle Felder optional) | `Commute` |
| DELETE | `/v1/commutes/:id` | ✅ | – | 204 (inkl. automatischer Trackings) |
| GET | `/v1/commutes/:id/preview` | ✅ | – | `CommutePreview` – nächste Verbindung, jetzt live geplant |

Body: `name` (1–40), `from`/`to` (`{ kind, id, name, lat, lon }`, id = Stop-ID oder `geo:<lat>,<lon>`),
`weekdays` (Bitmaske, Bit 0 = Mo … Bit 6 = So, 31 = Mo–Fr), `time` `"HH:MM"` (Europe/Berlin),
`timeMode` `depart` | `arrive`, `active`, `kinds` (leer = alle), `remindMinutes` (1–60, `null` = aus).

Hintergrund-Job (`services/commuteJob.ts`, jede Minute): Für jede aktive Strecke, deren Zeitfenster
läuft (90 Min. vor dem Losgehen bis Ankunft + 15 Min., Berliner Zeit inkl. Sommerzeit), plant der Server
mit MOTIS (alle 10 Min., in den letzten 20 Min. vor dem Losgehen alle 5 Min., nach der ersten Abfahrt
nicht mehr), wählt die Verbindung, die der Uhrzeit am nächsten kommt, und legt dafür automatische
Trackings an (`trackings.source = 'commute'`, nicht in `GET /v1/trackings`). Meldungen auf diesen
Linien alarmieren über die normale Kette (Titel mit Name der Strecke, `TrackingAlert.commuteId`).
Losgehen = erste Abfahrt (Echtzeit) − Fußweg − 1 Min.; X Min. vorher genau eine Push
`data.type = "commute"` (`event: leave`), danach höchstens eine Aktualisierung bei ≥ 3 Min.
Verschiebung (`update`) und eine Push bei Ausfall der Fahrt (`cancelled`). Sprache: `users.lang`.

## Konto & Geräte

| Methode | Pfad | Auth | Body | Antwort |
|---|---|---|---|---|
| GET | `/v1/me` | ✅ | – | `Me` |
| PATCH | `/v1/me` | ✅ | `{ displayName?, acceptTerms?: true }` | `Me` (`termsAcceptedAt` wird beim ersten Akzeptieren gesetzt) |
| DELETE | `/v1/me` | ✅ | – | 204 (Konto + Geräte + Trackings gelöscht, Meldungen anonymisiert) |
| POST | `/v1/devices` | ✅ | `{ token, platform: "ios" \| "android" \| "web" }` | 204 |
| DELETE | `/v1/devices` | ✅ | `{ token }` | 204 |

## Feedback & Passwort

| Methode | Pfad | Auth | Body | Antwort |
|---|---|---|---|---|
| POST | `/v1/feedback` | optional | `CreateFeedbackBody` (`category`, `message` 3–2000, `rating?` 1–5, `allowContact?`, `appVersion?`, `platform?`) | `{ id }` (201), max. 5/h pro IP |
| POST | `/v1/auth/password-reset` | – | `{ email }` | 204 (immer, auch ohne Konto), 503 `mail_not_configured` → App nutzt Firebase-Mail |
| POST | `/v1/mail/inbound` | Svix-Signatur | Webhook von Resend (`email.received`, `inbox.email.received`), Rohdaten | 200 `{ ok }` (auch `duplicate`/`ignored`), 401 falsche Signatur oder Zeitstempel > 5 Min., 404 ohne `RESEND_WEBHOOK_SECRET`; max. 120/min |

## Admin `/v1/admin/*` (siehe [ADMIN.md](ADMIN.md))

Nur Firebase-UIDs aus `ADMIN_UIDS`, für alle anderen 404. Zuerst `POST /v1/admin/login { code }`
(TOTP) → `{ session }`; danach jede Anfrage mit `Authorization: Bearer <ID-Token>` **und**
`X-Admin-Session: <session>`. Endpunkte: `GET overview`, `GET reports?view=recent|flagged|hidden&kind&uid&q`,
`POST reports/:id/hide|unhide`, `DELETE reports/:id`, `GET users?q&filter=all|banned|flagged`,
`GET users/:uid`, `POST users/:uid/ban {hideReports?}|unban|reset-name`, `DELETE users/:uid?deleteReports`,
`GET feedback?status`, `PATCH feedback/:id {status}`, `DELETE feedback/:id`, `GET audit`, `POST logout`.
Postfach: `GET inbox?status=NEW|READ|DONE|SPAM&q&limit&offset`, `GET inbox/:id` (setzt NEW → READ),
`PATCH inbox/:id {status}`, `DELETE inbox/:id`, `POST inbox/:id/reply {message ≤ 5000, lang?}`,
`POST inbox/:id/refetch`; `GET overview` enthält `inbox: { new, fetchFailed, enabled }`.

## WebSocket `/v1/ws`

1. Verbinden, dann `{ "type": "auth", "token": "<ID-Token>", "lang": "en" }` senden → `{ "type": "hello", "uid": "…" }` (`lang` optional, `en`/`de`)
2. Optional Linien beobachten: `{ "type": "watch", "lineKeys": ["subway:u8:berliner-verkehrsbetriebe"] }`
   → neue Meldungen kommen als `{ "type": "report", "report": … }`
3. Alarme aus Live-Trackings kommen als `{ "type": "alert", "alert": … }`
4. Alle 25 s `{ "type": "ping" }` senden (Server antwortet `pong`).

## Sonstiges

| GET | `/health` | `{ ok: true, db: true, transit: "motis" }` |
|---|---|---|
