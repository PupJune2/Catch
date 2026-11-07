# Catch – Admin-Bereich, Feedback und E-Mails

## Admin-Bereich `https://junify.live/admin/`

Hier verwaltest du **Konten** (suchen, Details, sperren/entsperren, Namen zurücksetzen,
Catch-Daten löschen), **Hinweise** (markierte, neueste, ausgeblendete; ausblenden,
wiederherstellen, löschen), **Feedback** (neu, gelesen, erledigt), das **Postfach** (empfangene
E-Mails lesen und beantworten, siehe unten) und siehst das **Protokoll**.

### Einmalig einrichten

```bash
sudo catch-admin 2fa
```

Den QR-Code scannst du mit einer Authenticator-App, zum Beispiel Google Authenticator, Aegis,
2FAS oder 1Password. Danach im Terminal `clear` eingeben. `sudo catch-admin 2fa` zeigt den Code
später erneut an; `sudo catch-admin 2fa --reset` erzeugt ein neues Geheimnis, etwa bei einem neuen
Handy.

Anmelden: E-Mail und Passwort deines Catch-Kontos, dann den 6-stelligen Code aus der App.

### Schutzschichten

| Schicht | Wirkung |
|---|---|
| Firebase-Login | Das ID-Token wird auf dem Server geprüft. Mit Service-Account wird auch geprüft, ob es widerrufen wurde. |
| UID-Freigabe | Nur `ADMIN_UIDS` aus `catch.env` – gesetzt mit `sudo catch-admin admin-uid <Firebase-UID>`, steht nicht im Code. Alle anderen bekommen ein schlichtes **404**; für sie gibt es den Bereich nicht. |
| Zweiter Faktor | TOTP-Code (RFC 6238). Jeder Code gilt nur einmal. Nach 5 falschen Codes ist der Login 15 Minuten gesperrt, zusätzlich gilt ein Rate-Limit pro IP. |
| Admin-Sitzung | Liegt nur im Arbeitsspeicher des Servers und gespeichert wird nur ein Hash. Sie endet nach 30 Minuten ohne Aktivität, spätestens nach 8 Stunden, und mit jedem Neustart. |
| Browser | Tokens liegen nur im Speicher, nicht in localStorage: Neuladen heißt neu anmelden. Eine strenge CSP lässt nur eigene Skripte zu. Die Seite ist nicht einbettbar, wird nicht indexiert und nie gecacht. Inhalte von Nutzern werden immer als Text angezeigt, nie als HTML. |
| Protokoll | Jede Aktion und jeder Anmeldeversuch wird mit Zeit und IP gespeichert, auch Zugriffe von Konten ohne Admin-Rechte. Das Protokoll wird nach 180 Tagen gelöscht. |
| IP-Erkennung | Der Server glaubt nur dem lokalen Nginx (`trustProxy` = loopback). Eine gefälschte `X-Forwarded-For`-Adresse umgeht damit weder Rate-Limits noch die IP-Freigabe. |
| Optional | `ADMIN_ALLOW_IPS=1.2.3.4,10.0.0.0/8` in `/etc/catch-junify/catch.env` lässt nur diese IPs herein. Danach `systemctl restart catch-junify`. |

Einstellungen in `/etc/catch-junify/catch.env`: `ADMIN_UIDS` (kommagetrennt),
`ADMIN_TOTP_SECRET`, `ADMIN_ALLOW_IPS` und `ADMIN_SESSION_MINUTES` (Standard 30). Fehlen
`ADMIN_UIDS` oder `ADMIN_TOTP_SECRET`, ist der Admin-Bereich komplett aus.

**Sperren oder löschen?**
- **Sperren** hält jemanden dauerhaft fern: Er kann nichts mehr melden, bewerten oder tracken.
  Feedback geht weiter, etwa als Einspruch. Auf Wunsch werden zusätzlich alle seine Hinweise
  ausgeblendet.
- **Löschen** entfernt nur die Catch-Daten. Das Firebase-Konto bleibt, weil es zu anderen Diensten
  im selben Firebase-Projekt gehören kann, und die Person könnte sich neu anmelden.

Die Kommandozeile funktioniert weiter: `sudo catch-admin flags | hide | unhide | delete | ban | unban`.
Sie schreibt aber direkt in die Datenbank: **ohne** Begründungs-Mail und ohne Eintrag unter
„Moderation decisions“. Für Entscheidungen, die Nutzer betreffen, deshalb den Admin-Bereich nehmen.

### Moderation mit Begründung (DSA Art. 17)

Beim **Ausblenden** oder **Löschen** eines Hinweises und beim **Sperren** eines Kontos wählst du
einen Grund (z. B. „False or misleading“, „Describes or exposes people“) und optional eine kurze
Notiz (höchstens 300 Zeichen, keine Daten über andere Personen). Die betroffene Person bekommt
automatisch eine Catch-Mail in ihrer Sprache. Darin stehen: was betroffen ist (Art, Linie, Halte,
Zeit), die Maßnahme, der Grund, die Notiz, ob ein Mensch oder das System entschieden hat, und wie
sie widersprechen kann. Entsperren und „Remove restriction“ verschicken eine kurze Entwarnung.

Automatische Entscheidungen bekommen dieselbe Mail mit dem Vermerk „automatisch“:
- 3 Markierungen von verschiedenen Nutzern → Hinweis ausgeblendet
- deutlich mehr Widersprüche als Bestätigungen (gewichtet, mindestens 3 mehr) → ausgeblendet.
  Hat der Admin den Hinweis wiederhergestellt oder die Markierungen verworfen, blenden Widersprüche
  ihn nicht mehr automatisch aus.
- Drosselung (siehe unten)

Ohne E-Mail-Adresse oder ohne `RESEND_API_KEY` geht keine Mail raus; die Entscheidung wird trotzdem
gespeichert. Pro Konto gehen höchstens 5 solcher Mails in 24 Stunden raus (Sperren und Entsperren
immer). Ein Versandfehler blockiert nie die Aktion; im Protokoll steht dann `mail_failed`. Alle
Entscheidungen siehst du im Konto (Abschnitt „Moderation decisions“) und unter
**Log → Moderation decisions**. Sie werden nach einem Jahr gelöscht.

Widerspruch: Mit `MAIL_REPLY_TO=kontakt@…` in `/etc/catch-junify/catch.env` landen Antworten auf
alle Catch-Mails dort, und die Mail sagt „antworte einfach auf diese E-Mail“. Ohne diese Einstellung
nennt sie `CONTACT_EMAIL` (falls gesetzt), sonst „Feedback senden“ in der App.

### Vertrauen und Drosselung

Punktzahl der letzten 90 Tage: + Bestätigungen − Widersprüche − 2 × Markierungen − 5 × ausgeblendete
oder gelöschte Hinweise + min(Hinweise ÷ 5, 4) + min(Kontoalter in Monaten, 2). Stufen: ab 1 → 1,
ab 10 → 2 („Trusted reporter“, Abzeichen in der App), ab 50 → 3. Stufe 0 heißt in der App
„unbestätigt“, bis jemand den Hinweis bestätigt. Ab −5 Punkten lösen Hinweise Live-Alarme erst nach
der ersten Bestätigung aus, zählen bis dahin nicht in der Linien-Auswertung, und die Stimmen des
Kontos zählen beim automatischen Ausblenden nur halb.

**Drosselung:** Sind in 7 Tagen 3 Hinweise eines Kontos ausgeblendet, gelöscht oder haben mindestens
3 Widersprüche mehr als Bestätigungen, gilt für 7 Tage: höchstens 3 Hinweise pro Tag und einer alle
30 Minuten. Im Konto steht dann „reporting limited“. Mit **Remove restriction** hebst du die Drosselung
auf; ältere Hinweise lösen sie danach nicht erneut aus. Formel und Grenzwerte:
`server/src/services/trust.ts`.

### Auf Feedback antworten

Hat jemand einer Antwort per E-Mail zugestimmt, zeigt die Feedback-Karte **Reply**. Die Antwort
(höchstens 3000 Zeichen) geht als Catch-Mail raus. Sie zitiert das ursprüngliche Feedback, ist mit
„Dein Catch-Team“ unterschrieben und kommt in der Sprache, in der das Feedback geschrieben wurde. Die
Antwort wird gespeichert und das Feedback auf „erledigt“ gesetzt. Ohne Zustimmung gibt es keinen
Button, und die Karte nennt den Grund.

## E-Mails empfangen (Tab „Inbox“)

Antworten auf Catch-Mails (z. B. Widersprüche gegen Moderations-Entscheidungen) gehen an
`MAIL_REPLY_TO` (z. B. `contact@junify.live`). Resend empfängt alle Mails an `@junify.live` und
meldet jede neue Mail per Webhook an Catch. Im Admin-Bereich liest und beantwortest du sie im Tab
**Inbox**.

### So läuft es ab

1. Resend schickt `POST https://junify.live/v1/mail/inbound` (Ereignis `email.received`). Der
   Webhook enthält nur Metadaten (Absender, Empfänger, Betreff, ID).
2. Catch prüft die Signatur (Svix, `RESEND_WEBHOOK_SECRET`) über die unveränderten Rohdaten und den
   Zeitstempel (höchstens 5 Minuten alt). Falsche Signatur → 401; ist kein Secret gesetzt, gibt es
   die Adresse nicht (404). Jede Webhook-ID wird gespeichert; schickt Resend dieselbe Zustellung
   noch einmal, wird sie erkannt und nicht doppelt angelegt.
3. Catch antwortet sofort mit 200 und lädt den Inhalt im Hintergrund über die Resend-API
   (`GET /emails/receiving/{id}`). Gespeichert wird **nur reiner Text**. Hat die Mail nur HTML, wird
   es auf dem Server in Text umgewandelt; HTML wird im Admin-Bereich nie angezeigt. Von Anhängen
   speichert Catch nur Name, Typ und Größe, nie den Inhalt.
4. Klappt der Abruf nicht (z. B. Key ohne Leserecht), bleibt die Mail mit den Metadaten und dem
   Hinweis „content missing“ stehen. Catch versucht es automatisch erneut (nach 5, 20, 45 …
   Minuten, höchstens 8 Versuche). In der Mail gibt es außerdem **Try again now**.
5. Gehört die Absender-Adresse zu einem Catch-Konto (Groß-/Kleinschreibung egal), wird die Mail
   dem Konto zugeordnet.

### Einrichten (einmalig)

Voraussetzung: Receiving ist in Resend für `junify.live` aktiv (MX-Eintrag gesetzt, z. B. Inbox
`contact@junify.live`).

1. **Webhook anlegen:** resend.com → **Webhooks** → **Add Webhook**
   - Endpoint URL: `https://junify.live/v1/mail/inbound`
   - Events: `email.received`. Nutzt du Resend Inboxes, zusätzlich `inbox.email.received`; eine Mail
     wird trotzdem nur einmal angelegt.
   - Speichern, dann das **Signing Secret** (`whsec_…`) kopieren und eintragen:
     ```bash
     sudo catch-admin resend-webhook
     ```
     Alternativ `RESEND_WEBHOOK_SECRET=whsec_…` in `/etc/catch-junify/catch.env` und
     `systemctl restart catch-junify`. Ein Secret im falschen Format verhindert den Start; das
     Journal nennt dann den Grund.
2. **API-Key zum Lesen:** Empfangene Mails liest nur ein Key mit **Full access** (ein „Sending
   access“-Key bekommt 401/403). resend.com → **API Keys** → **Create API Key** → Permission
   *Full access* → eintragen:
   ```bash
   sudo catch-admin resend-inbound-key
   ```
   (`RESEND_INBOUND_API_KEY`). Ohne diesen Key nimmt Catch `RESEND_API_KEY`. Gesendet wird
   weiterhin mit `RESEND_API_KEY`.
3. **Testen:** Schreib eine Mail an `contact@junify.live`. Sie erscheint nach wenigen Sekunden im
   Tab **Inbox** (mit Zähler am Tab und auf der Übersicht). In Resend unter Webhooks → Endpoint
   sollten die Zustellungen mit **200** stehen. **401** heißt: falsches Secret, oder die Serveruhr
   geht falsch (Zeitstempel). **404** heißt: Secret fehlt. Steht die Mail mit „content missing“
   da, nennt die Detailansicht den Fehler, meist der Key.

### Im Admin-Bereich

- Filter **New / Read / Done / Spam / All** und Suche (Absender, Betreff, Text). Öffnen setzt
  „new“ auf „read“.
- Karten zeigen Absender, Betreff, Zeit, den Konto-Chip (falls zugeordnet), **⚠**, wenn SPF, DKIM
  oder DMARC fehlgeschlagen sind (der Absender kann gefälscht sein), 📎 mit der Zahl der Anhänge und
  „auto-reply“ bei Abwesenheitsnotizen.
- Die Detailansicht zeigt Kopfdaten, Prüfergebnisse, den Text, die Anhänge (nur Liste; zum
  Herunterladen die Mail im Resend-Dashboard unter Emails → Receiving öffnen), das zugeordnete
  Konto mit seinen letzten Moderations-Entscheidungen und seinem Feedback, weitere Mails desselben
  Absenders und deine bisherigen Antworten.
- **Antworten** (höchstens 5000 Zeichen): Die Antwort geht als Catch-Mail an die Absender-Adresse,
  vom Absender `MAIL_FROM`, mit reply_to `MAIL_REPLY_TO`. Der Betreff ist „Re: …“, ohne doppeltes
  „Re:/AW:“, und `In-Reply-To`/`References` halten sie im selben Thread. Die Mail enthält eine
  Anrede (entfällt, wenn deine Antwort schon mit „Hallo …“ oder „Hi …“ beginnt), deinen Text, die
  Signatur „Dein Catch-Team“ bzw. „The Catch team“ und darunter die ursprüngliche Nachricht,
  gekürzt und ohne alten Zitatverlauf. Die Sprache richtet sich nach dem zugeordneten Konto, sonst
  wird sie aus der Mail erraten; du kannst sie vor dem Senden ändern. Die Antwort wird gespeichert
  und die Mail auf „done“ gesetzt. Schlägt der Versand fehl, steht der Versuch als „not sent“ da.
- **Mark done**, **Spam**, **Not spam/Reopen**, **Mark as new**, **Delete**. Gelöscht wird nur die
  Kopie in Catch, nicht die Mail bei Resend. Jede Antwort, Statusänderung, Löschung und jeder
  erneute Abruf steht im Protokoll (`inbox_reply`, `inbox_status`, `inbox_delete`,
  `inbox_refetch`).

### Datenschutz

Empfangene Mails und deine Antworten werden nach **12 Monaten** gelöscht, die IDs verarbeiteter
Webhooks nach 30 Tagen. Gespeichert werden Absender, Empfänger, Betreff, Text, eine Auswahl an
Headern (Datum, Message-IDs, Prüfergebnisse) und die Liste der Anhänge, aber keine Anhänge selbst.
Die Datenschutzerklärung (Nr. 9) beschreibt das.

## Feedback

In der App unter Profil → **Feedback senden**: Kategorie (Fehler, Idee, Lob, Sonstiges), Text und
optional 1–5 Sterne. Mit Konto kann die Person einer Antwort per E-Mail zustimmen; nur dann sieht
der Admin-Bereich ihre Adresse. Erlaubt sind 5 Nachrichten pro Stunde und IP. Feedback wird nach
12 Monaten gelöscht.

## E-Mails „Passwort vergessen“ (Resend, eigenes Design)

So läuft es ab:
1. Die App ruft `POST /v1/auth/password-reset` auf.
2. Der Server lässt Firebase den Einmal-Code erzeugen (dafür braucht er den Service-Account).
3. Er verschickt die gestaltete Catch-Mail (EN/DE) über Resend.
4. Der Link führt auf **`https://junify.live/reset-password`**, eine eigene Seite statt der Firebase-Seite.

Die Antwort verrät nie, ob es ein Konto zu der Adresse gibt. Pro Adresse gehen höchstens 3 Mails
pro Stunde raus, pro IP höchstens 5 Anfragen in 15 Minuten. Ist Resend nicht eingerichtet oder der
Versand schlägt fehl, schickt die App automatisch die Standard-Mail von Firebase.

### Einrichten

1. **Domain bei Resend verifizieren:** resend.com → Domains → `junify.live` hinzufügen. Die
   angezeigten DNS-Einträge (SPF/DKIM, meist TXT und MX auf `send.junify.live` sowie
   `resend._domainkey`) beim Domain-Anbieter eintragen und warten, bis Resend „Verified“ zeigt.
2. **API-Key:** Hat die anderen App auf dem Server schon einen Resend-Key, übernimmt `setup.sh`/`update.sh`
   ihn automatisch. Sonst unter resend.com → API Keys einen Key anlegen (Berechtigung „Sending
   access“) und eintragen:
   ```bash
   sudo catch-admin resend-key
   ```
   Die Eingabe wird nicht angezeigt; danach startet Catch neu. Der Key muss von der Domain
   `junify.live` senden dürfen. Ein Key der anderen App auf dem Server ist oft auf deren Domain beschränkt;
   dann meldet Resend „not authorized to send emails from junify.live“. Den Absender änderst du mit
   `MAIL_FROM="Catch <noreply@junify.live>"` in `/etc/catch-junify/catch.env`.
3. **Testen:**
   ```bash
   sudo catch-admin mail-test deine@adresse.de
   ```
   Danach in der App „Passwort vergessen?“ mit deinem eigenen Konto ausprobieren.

Voraussetzung ist der Firebase-Service-Account (`~/your-firebase-project-firebase-adminsdk-….json`).
`setup.sh` übernimmt ihn automatisch.
