# Catch – App (iOS, Android, Web-Vorschau)

Die mobile App für Catch – **Live-Hinweise für deine Fahrt**: Verbindungen suchen,
Hinweislage jeder Linie sehen, Verspätungen, Ausfälle, Überfüllung, Störungen oder
Fahrkartenkontrollen melden und Live-Tracking mit Popup + Ton.

**Technik:** Expo SDK 58 · React Native 0.88 · Expo Router · TypeScript ·
Firebase Auth (JS SDK 13) · Expo Notifications · WebSocket für Live-Alarme.

---

## 1. Schnellstart (lokal)

Voraussetzungen: Node.js ≥ 22, ein laufender Catch-Server (siehe `../server`).

```bash
cd app
npm install
cp .env.example .env
```

In `.env` die Server-Adresse eintragen:

| Situation | `EXPO_PUBLIC_API_URL` |
|---|---|
| Web-Vorschau / iOS-Simulator auf demselben Rechner | `http://localhost:8080` |
| Android-Emulator | `http://10.0.2.2:8080` |
| Echtes Handy im selben WLAN | `http://<IP-deines-Rechners>:8080` |
| Dein Server | `https://junify.live` (Standard in fertigen Builds) |

Dann starten:

```bash
npx expo start --go
```

- **`w`** öffnet die Web-Vorschau im Browser (schnellster Weg, um die Oberfläche zu sehen).
- **QR-Code** mit der Kamera (iOS) bzw. der **Expo-Go**-App (Android) scannen.
  Ohne `--go` erwartet Expo einen eigenen Development Build (siehe unten).

### Ohne Firebase testen (Entwickler-Login)

Setze in `.env` `EXPO_PUBLIC_AUTH_MODE=dev` **und** starte den Server mit `AUTH_MODE=dev`.
Dann gibt es auf dem Login-Screen einen „Entwickler-Login“ nur mit Namen. Mit zwei
Browserfenstern (zwei Namen) kannst du Melden + Live-Alarm komplett durchspielen.
**Niemals in einem echten Build verwenden.**

---

## 2. Firebase

Die Firebase-Konfiguration (Projekt `your-firebase-project`) steht in `src/config.ts`.
Sie ist laut Firebase *kein Geheimnis* – die Sicherheit kommt daher, dass der
Server jedes ID-Token prüft. Einmalig in der Firebase-Konsole erledigen:

1. **Authentication → Anmeldemethode → E-Mail/Passwort** aktivieren.
2. **Authentication → Einstellungen → Autorisierte Domains:** `junify.live` eintragen (Web-Version).
3. Für Push auf Android: **Projekteinstellungen → Allgemein → App hinzufügen → Android**,
   Paketname **`live.junify.catch`** – ✅ erledigt, `app/google-services.json` liegt im Repository.
4. Empfohlen: In der Google Cloud Console den API-Key auf deine App beschränken und
   später **App Check** aktivieren.

Werte lassen sich per `EXPO_PUBLIC_FIREBASE_*` in `.env` überschreiben.

---

## 3. Live-Alarme & Push

Live-Alarme kommen auf zwei Wegen:

1. **App offen:** WebSocket → Popup + Ton + Vibration (funktioniert überall, auch in Expo Go und im Web).
2. **App geschlossen:** Push-Benachrichtigung. Dafür gibt es zwei Wege – die App wählt automatisch:

| Weg | Was du brauchst | Für |
|---|---|---|
| **Firebase direkt (FCM)** – empfohlen für den Start | `app/google-services.json` (✅ vorhanden) + Service-Account auf dem Server (`sudo catch-admin firebase-key …`) | Android |
| **Expo Push Service** | Expo-Konto, `eas init` (Projekt-ID), FCM-/APNs-Schlüssel bei Expo hinterlegt | Android + iOS |

Expo Go kann keine Push-Nachrichten empfangen – dafür braucht es die echte APK (Abschnitt 4)
oder einen Development Build (`eas build --profile development`).

---

## 4. Android-App über GitHub Actions

Ja – GitHub baut die Android-App automatisch, **ohne Expo-Konto und ohne Android Studio**:
[`.github/workflows/android-app.yml`](../.github/workflows/android-app.yml).

**Starten:** automatisch bei jeder Änderung in `app/`, oder auf GitHub
**Actions → „Android-App bauen“ → Run workflow**. Ein Lauf dauert ca. 10–20 Minuten.

**Ergebnis:** im Lauf unten unter **Artifacts → `catch-android`** (ZIP mit der APK).
Aufs Handy kopieren und installieren („Installation aus unbekannten Quellen“ erlauben) –
oder auf den Server legen, dann lädt sie jeder unter `https://junify.live/download/catch.apk`:

```bash
sudo catch-admin apk catch-0.1.0-12.apk
```

**Optionale Secrets** (Repository → Settings → Secrets and variables → Actions):

| Secret | Wofür |
|---|---|
| `GOOGLE_SERVICES_JSON` | nur falls du `app/google-services.json` aus dem Repository entfernst: deren Inhalt |
| `CATCH_KEYSTORE_BASE64` | eigener Signatur-Schlüssel (base64 der `.jks`) – nötig für den Play Store und damit Updates sich immer über die alte Version installieren lassen |
| `CATCH_KEYSTORE_PASSWORD`, `CATCH_KEY_ALIAS`, `CATCH_KEY_PASSWORD` | Passwörter/Alias zum Schlüssel |

Ohne Keystore signiert GitHub mit dem öffentlichen Debug-Schlüssel – zum Testen völlig ok.

Eigenen Schlüssel einmalig erzeugen und **gut aufbewahren** – ohne ihn lassen sich keine
Updates mehr für installierte Apps bauen. Mit Java (`keytool`):

```bash
keytool -genkeypair -v -keystore catch-release.jks -alias catch -keyalg RSA -keysize 4096 -validity 10000
```

Den Inhalt für `CATCH_KEYSTORE_BASE64` liefert `base64 -w0 catch-release.jks`; Passwörter und Alias
(`catch`) kommen in die anderen drei Secrets. `*.jks` steht in `.gitignore` – der Schlüssel gehört
nie ins Repository. (Gibt es im Hauptordner ein `key.sh`, erledigt es all das automatisch.)

Die Server-Adresse in der APK ist `https://junify.live`; ändern über die Repository-Variable
`CATCH_API_URL`. Die Versionsnummer für Updates (`versionCode`) zählt mit jedem Lauf hoch.

### Alternative: EAS Build (Expo-Cloud)

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --profile preview --platform android
```

Nötig für **iOS**-Builds (zusätzlich Apple-Developer-Account) und `eas submit` in die Stores.

---

## 5. Projektstruktur

```
app/
├── app.json                 Expo-Konfiguration (Name, Icons, Berechtigungen, Plugins)
├── app.config.js            ergänzt beim Bauen: google-services.json, versionCode
├── plugins/                 Config-Plugins (z. B. Android-Namespace)
├── eas.json                 Build-Profile inkl. Server-URL
├── assets/
│   ├── ghost.svg            Logo (Quelle) – `npm run icons` erzeugt daraus die PNGs
│   └── images/              icon, adaptive-icon, splash-icon, favicon
├── scripts/generate-icons.mjs
└── src/
    ├── app/                 Screens (Expo Router, dateibasiert)
    │   ├── _layout.tsx      Fonts, Provider, Stack, globales Alarm-Popup
    │   ├── (tabs)/          Start · Suche · Live · Profil (+ Melden-Knopf in der Mitte)
    │   ├── line/[key].tsx   Linien-Statistik (Filter nach Art): Stoßzeiten, Hotspots, alle Meldungen
    │   ├── journey.tsx      Verbindungsdetails mit Status je Linie + Live-Tracking
    │   ├── report.tsx       Melden in 4 Schritten (Art → Linie → Haltestellen → Details)
    │   ├── track-new.tsx    Live-Tracking: Haltestelle → Abfahrt wählen
    │   └── login.tsx        Login / Registrieren / Passwort vergessen
    ├── api/                 contract.ts (= Server-Vertrag), client.ts, endpoints.ts
    ├── components/          Design-System: StatusCard, Timeline, DayStrip, Charts, TabBar …
    ├── lib/                 Auth, Firebase, Push, Standort, Formatierung, Hooks
    ├── i18n/                Übersetzungen: en.ts (Standard), de.ts, useI18n()
    ├── realtime/            WebSocket-Verbindung, Live-Alarme, Linien beobachten
    ├── config.ts            Server-URL, Firebase-Config, Auth-Modus
    └── theme.ts             Farben, Abstände, Schriften
```

`src/api/contract.ts` ist eine Kopie von `server/src/contract.ts`.
Nach Änderungen am Server: `cd server && npm run sync-contract`.

---

## 6. Design

Dunkles Navy mit Status-Farben:

| Farbe | Bedeutung |
|---|---|
| Lime `#C7E8A5` | ruhig (Quiet) |
| Lila `#C9BBDA` | häufige Hinweise (Frequent tips, letzte 30 Tage) |
| Orange `#FF7A1A` | gerade gemeldet (Just reported, letzte Stunde) |
| Cyan `#2EC8E6` | Live-Tracking |

Status-Karten (`StatusCard`) tragen im Körper die Farbe des Verkehrsmittels
(`modeSurface` in `src/theme.ts`, für weiße Schrift ≥ 4,5:1 Kontrast); der Status steckt
als farbiges Label im Reiter.

Schrift: Plus Jakarta Sans. Logo: der Catch-Geist (`src/components/GhostLogo.tsx`).

### Hinweis-Arten

| Art | Icon | Merkmale (`TAGS_BY_KIND`) |
|---|---|---|
| `DELAY` Verspätung | Uhr | bis 5 / 5–15 / über 15 Min. (genau eins) |
| `CANCELLED` Ausfall | x-Kreis | fällt aus, Ersatzverkehr, hält nicht überall |
| `CROWDED` Überfüllt | Personen | voll, sehr voll, kein Platz für Rad/Kinderwagen |
| `DISRUPTION` Störung | Warndreieck | Türen, Klima/Heizung, Aufzug/Rampe, Sonstiges |
| `CHECK` Kontrolle | Ticket | im Fahrzeug, an der Haltestelle, beim Aussteigen |

Icons, Akzentfarben und Texte: `src/lib/kinds.ts`, Bausteine (Kachel, Badge, Filter-
und Mehrfachauswahl-Chips): `src/components/kinds.tsx`. Die App schickt beim Melden
immer `kind`; Linien-Statistik und Meldungsliste filtern mit `?kind=`, Live-Tracking
speichert `kinds` („Alarm bei“, leer = alle). Veraltete Merkmale alter Meldungen
(Personenbeschreibungen) werden nicht mehr angezeigt.

### Inhalt melden & Nutzungsbedingungen

- **Inhalt melden:** In der Meldungsliste einer Linie über „⋮“ (oder lange drücken, auch
  im Start-Feed) → Grund wählen → `POST /v1/reports/:id/flag`. Nicht für eigene Meldungen.
- **Registrieren** geht nur mit Häkchen bei Nutzungsbedingungen + Datenschutzerklärung;
  danach `PATCH /v1/me {acceptTerms: true}`. Konten ohne Zustimmung
  (`termsAcceptedAt: null`) sehen einmal ein Popup (Akzeptieren oder Abmelden,
  `src/components/TermsGate.tsx`).
- Links auf junify.live je nach App-Sprache (`src/lib/legal.ts`), auch im Profil unter
  „Rechtliches“: Nutzungsbedingungen, Datenschutz, Impressum.

---

## 7. Sprachen (Englisch / Deutsch)

Die App ist zweisprachig: **Englisch ist Standard**, Deutsch lässt sich im **Profil**
(„Language / Sprache“) oder im Login oben rechts (**EN | DE**) umschalten. Die Wahl wird
auf dem Gerät gespeichert (AsyncStorage, im Web localStorage).

- Texte: `src/i18n/en.ts` (Quelle, legt die Schlüssel fest) und `src/i18n/de.ts`
  (muss alle Schlüssel enthalten – sonst schlägt `npm run typecheck` fehl).
- In Komponenten: `const { t, tn } = useI18n();` → `t('home.title')`,
  Platzhalter `t('line.days', { n: 30 })`, Plural `tn('journey.stops', anzahl)`
  (Schlüssel `journey.stops_one` / `journey.stops_other`).
- Außerhalb von Komponenten (Helfer, API-Client): `t()` und `getLang()` aus `@/i18n`.
- Neuer Text: Schlüssel in **beiden** Dateien ergänzen, dann im Code `t('…')` verwenden.
- Datum/Uhrzeit: `src/lib/format.ts` formatiert in der aktuellen Sprache (Zeitzone Europe/Berlin).
- Der Server antwortet in der App-Sprache: Die App schickt bei jeder Anfrage
  `Accept-Language: en|de` und beim WebSocket-Login `lang` – so kommen Fehlermeldungen,
  die „Catch-Prognose“ und Push-Alarme ebenfalls in der gewählten Sprache.

Hinweis: Der React Compiler ist abgeschaltet (`app.json → experiments.reactCompiler`),
weil seine automatische Memoisierung sonst Texte der alten Sprache zwischenspeichern könnte.

---

## 8. Nützliche Befehle

```bash
npm run typecheck        # TypeScript prüfen
npx expo-doctor          # Abhängigkeiten & Konfiguration prüfen
npm run export:web       # Web-Build nach dist/
npm run icons            # Icons aus assets/ghost.svg neu erzeugen (braucht Playwright)
```
