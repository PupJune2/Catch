# Firebase einrichten (Login & Push)

Catch nutzt Firebase für den **Login** und (optional) für **Push-Nachrichten** an die
Android-App. Alle Meldungen, Statistiken und Trackings liegen auf deinem eigenen Server.

```
App ──(E-Mail + Passwort)──▶ Firebase Auth ──▶ ID-Token (1 h gültig)
App ──(Authorization: Bearer <ID-Token>)──▶ Catch-Server ──prüft Signatur──▶ OK
```

Der Server braucht dafür **keinen geheimen Schlüssel** – nur die Projekt-ID (`your-firebase-project`).
Er prüft die Signatur des Tokens mit Googles öffentlichen Schlüsseln.

## Schritte in der Firebase-Konsole (Projekt `your-firebase-project`)

1. **Authentication → Sign-in method → E-Mail/Passwort** aktivieren.
2. **Authentication → Settings → Authorized domains**: deine Domain(s) ergänzen, falls du
   die Web-Version der App betreibst (für die native App nicht nötig).
3. **Authentication → Templates**: Texte der E-Mails (Passwort zurücksetzen, Bestätigung)
   auf Deutsch umstellen.
4. Optional: **Benutzerkontenschutz / E-Mail-Aufzählungsschutz** aktiviert lassen.

## Push-Benachrichtigungen (Android, ohne Expo-Konto)

1. ✅ Android-App **`live.junify.catch`** ist in Firebase angelegt, ihre `google-services.json`
   liegt unter `app/google-services.json` → jede APK aus GitHub Actions kann Push empfangen.
2. **Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren** → die JSON-Datei
   (`your-firebase-project-firebase-adminsdk-….json`) nach **`~/`** (deinen Home-Ordner auf dem Server) auf den Server legen.
   `setup.sh` bzw. `update.sh` findet und installiert sie automatisch. Alternativ von Hand:

```bash
sudo catch-admin firebase-key ~/your-firebase-project-firebase-adminsdk-….json
```

Der **Service-Account-Schlüssel ist geheim** (er darf Nachrichten in deinem Namen senden):
nicht ins Repository, nicht weitergeben. Er liegt auf dem Server unter
`/etc/catch-junify/firebase-service-account.json` (nur für root und den Dienst lesbar).
Der Server prüft, dass der Schlüssel zum Projekt `your-firebase-project` gehört.

## Ist die Web-Config (apiKey …) geheim?

Nein. Die Werte aus `firebaseConfig` sind dafür gedacht, in Apps eingebaut zu werden –
sie identifizieren nur das Projekt. Sicherheit entsteht durch:

- die Token-Prüfung auf dem Catch-Server,
- Missbrauchsregeln auf dem Server (Limits pro Nutzer, Abstimmungen, Sperren),
- optional **API-Key-Beschränkungen** in der Google Cloud Console
  (APIs & Dienste → Anmeldedaten → Browser-Key → nur „Identity Toolkit API“ und
  „Token Service API“ erlauben),
- optional **Firebase App Check** (verhindert, dass fremde Skripte deine Firebase-Konten
  anlegen) – siehe Roadmap.

## Später: Google- und Apple-Login

Für „Mit Google anmelden“ / „Mit Apple anmelden“ braucht die App einen
**Development Build** (nicht Expo Go). Die Server-Seite ändert sich dabei nicht – es
bleibt ein Firebase-ID-Token. Hinweis: Wer im App Store Google-Login anbietet, muss laut
Apple-Richtlinien auch „Mit Apple anmelden“ anbieten.

## Konto löschen (DSGVO)

In der App unter **Profil → Konto löschen**:
1. Server löscht Nutzer, Geräte, Live-Trackings und Stimmen; Meldungen bleiben
   **anonymisiert** für die Statistik erhalten.
2. Die App löscht danach das Firebase-Konto.
