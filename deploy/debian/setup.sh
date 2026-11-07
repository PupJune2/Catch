#!/usr/bin/env bash
# Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
# SPDX-License-Identifier: AGPL-3.0-only
# GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
set -Eeuo pipefail
umask 027

usage() {
  cat <<'EOF'
Catch (junify.live) – Ersteinrichtung auf Debian 12 oder 13
(läuft neben anderen Seiten wie andere Apps auf demselben Server)

1. Firebase-Schlüssel (your-firebase-project-firebase-adminsdk-….json) nach ~/ legen
2. Aus dem entpackten oder geklonten Catch-Ordner starten:
     sudo bash deploy/debian/setup.sh
   Das Skript erledigt alles selbst – ohne Rückfragen: Pakete, Datenbank, Bauen,
   Dienst, Nginx, HTTPS-Zertifikat, Push-Schlüssel, Sicherungen.

Schon installiert? Für neue Versionen deploy/debian/update.sh nutzen.
setup.sh erneut auszuführen ist trotzdem sicher: Datenbank, Einstellungen und
Zertifikat bleiben erhalten.

Optionale Einstellungen (alle haben sinnvolle Standardwerte):
  CATCH_DOMAIN=junify.live          Website (+ API, Downloads)
  CATCH_APP_DOMAIN=app.junify.live  Web-App (Standard: app.<CATCH_DOMAIN>)
  CATCH_WWW=auto|yes|no             www.junify.live mitbedienen (auto = wenn DNS stimmt)
  LETSENCRYPT_EMAIL=admin@example.com   (Standard: die E-Mail deiner anderen Zertifikate)
  CATCH_PORT=8095                   (belegt? → nächster freier Port)
  CATCH_WEB=yes|no                  Web-Version der App bauen (Standard: yes)
  FIREBASE_KEY=/pfad/datei.json     (Standard: neueste ~/your-firebase-project-firebase-adminsdk-*.json)
  CATCH_DNS_WAIT=no                 nicht auf DNS warten
  SETUP_CONFIRM=yes                 ohne 10-Sekunden-Pause vor dem Start

Andere Seiten (Dienste, Nginx-Sites, Datenbanken, Firewall, Fail2ban) werden NICHT verändert.
EOF
}
[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { usage; exit 0; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/debian/lib.sh
source "$SCRIPT_DIR/lib.sh"
CHECKOUT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"

trap 'status=$?; printf "\n%sSetup bei Zeile %s abgebrochen (Code %s).%s Siehe Ausgabe oben%s.\n" "$C_R$C_B" "$LINENO" "$status" "$C_0" "${CATCH_LOG_FILE:+ bzw. $CATCH_LOG_FILE}" >&2' ERR

# --- Vorprüfung ----------------------------------------------------------------
require_root
require_debian
acquire_lock
command -v curl >/dev/null 2>&1 || { apt-get update && apt-get install -y curl; }
require_source_tree "$CHECKOUT_DIR"
start_log setup
VERSION="$(source_version "$CHECKOUT_DIR")"

printf '\n%sCatch %s – Einrichtung%s\n' "$C_B" "$VERSION" "$C_0"
if [[ -f "$CATCH_UNIT" ]]; then
  printf '%sCatch ist bereits installiert.%s Für neue Versionen ist update.sh schneller (mit automatischem Zurückrollen).\n' "$C_Y$C_B" "$C_0"
  printf 'Fortfahren wendet die Konfiguration erneut an; Datenbank und Zertifikat bleiben erhalten.\n'
  CATCH_DOMAIN="${CATCH_DOMAIN:-$(site_domain)}"
  CATCH_PORT="${CATCH_PORT:-$(installed_port)}"
fi

# --- Einstellungen automatisch bestimmen ----------------------------------------
CATCH_DOMAIN="${CATCH_DOMAIN:-$CATCH_DEFAULT_DOMAIN}"
CATCH_DOMAIN="${CATCH_DOMAIN,,}"
[[ "$CATCH_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail "CATCH_DOMAIN muss ein vollständiger DNS-Name sein (z. B. junify.live)."
CATCH_APP_DOMAIN="${CATCH_APP_DOMAIN:-$(app_site_domain)}"
CATCH_APP_DOMAIN="${CATCH_APP_DOMAIN:-app.$CATCH_DOMAIN}"
CATCH_APP_DOMAIN="${CATCH_APP_DOMAIN,,}"
for d in "$CATCH_DOMAIN" "$CATCH_APP_DOMAIN"; do
  if other="$(domain_claimed_elsewhere "$d")"; then
    fail "$d wird schon von einer anderen Nginx-Site benutzt ($other). Bitte dort entfernen oder eine andere Domain wählen."
  fi
done

# E-Mail für Let's Encrypt: dieselbe wie bei deinen anderen Zertifikaten.
DEFAULT_MAIL="$(letsencrypt_default_email)"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$DEFAULT_MAIL}"
if [[ -z "$LETSENCRYPT_EMAIL" && -t 0 ]]; then
  read -r -p "E-Mail für Let's-Encrypt-Hinweise (leer = ohne): " LETSENCRYPT_EMAIL
fi
if [[ -n "$LETSENCRYPT_EMAIL" ]]; then
  [[ "$LETSENCRYPT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "LETSENCRYPT_EMAIL ist keine gültige E-Mail-Adresse."
fi

# Firebase-Schlüssel für Push: automatisch in ~ suchen.
if [[ -n "${FIREBASE_KEY:-}" ]]; then
  valid_firebase_key "$FIREBASE_KEY" || fail "$FIREBASE_KEY ist kein Firebase-Service-Account des Projekts $CATCH_FIREBASE_PROJECT."
fi
FOUND_KEY="$(find_firebase_key "$CHECKOUT_DIR")"
if [[ -n "$FOUND_KEY" ]]; then
  ok "Firebase-Schlüssel gefunden: $FOUND_KEY"
elif [[ -s "$CATCH_FIREBASE_KEY" ]]; then
  ok "Firebase-Schlüssel bereits installiert"
else
  warn "Kein Firebase-Schlüssel in $CATCH_KEY_HOME gefunden ($CATCH_KEY_PATTERN) – Push bleibt vorerst aus."
fi

# Port: Wunsch oder Standard; ist er belegt, den nächsten freien nehmen.
CATCH_PORT="${CATCH_PORT:-$CATCH_DEFAULT_PORT}"
[[ "$CATCH_PORT" =~ ^[0-9]{2,5}$ ]] && (( CATCH_PORT >= 1024 && CATCH_PORT <= 65535 )) || fail "CATCH_PORT muss zwischen 1024 und 65535 liegen."
if port_in_use_by_other "$CATCH_PORT"; then
  wanted="$CATCH_PORT"
  CATCH_PORT="$(pick_free_port "$CATCH_PORT")" || fail "Kein freier Port ab $wanted gefunden. Mit CATCH_PORT=… einen freien Port wählen."
  warn "Port $wanted ist belegt – Catch nimmt Port $CATCH_PORT."
fi

# --- DNS: Einträge anzeigen und prüfen (Website + App-Subdomain) ------------------------
dns_init
dns_all_ok() { dns_points_here "$CATCH_DOMAIN" && dns_points_here "$CATCH_APP_DOMAIN"; }
APP_SUB="${CATCH_APP_DOMAIN%."$CATCH_DOMAIN"}"
DNS_OK=0
if dns_all_ok; then
  DNS_OK=1
  ok "DNS: $CATCH_DOMAIN und $CATCH_APP_DOMAIN zeigen bereits auf diesen Server."
else
  printf '\nBitte beim Domain-Anbieter von %s anlegen (falls noch nicht vorhanden):\n\n' "$CATCH_DOMAIN"
  printf '  Typ     Name/Host                 Wert                                     TTL\n'
  for entry in "@|$CATCH_DOMAIN" "$APP_SUB|$CATCH_APP_DOMAIN"; do
    host="${entry%%|*}"; full="${entry#*|}"
    dns_points_here "$full" && continue
    [[ -n "$PUBLIC_IPV4" ]] && printf '  A       %-25s %-40s 3600\n' "$host  (= $full)" "$PUBLIC_IPV4"
    [[ -n "$PUBLIC_IPV6" ]] && printf '  AAAA    %-25s %-40s 3600\n' "$host  (= $full)" "$PUBLIC_IPV6"
  done
  [[ -n "$PUBLIC_IPV4" ]] && printf '  A       %-25s %-40s 3600   (optional)\n' "www" "$PUBLIC_IPV4"
  [[ -z "$PUBLIC_IPV4$PUBLIC_IPV6" ]] && printf '  (Öffentliche IP nicht ermittelbar – nimm dieselbe IP wie bei deinen anderen Domains.)\n'
  printf '\nAlte A-/AAAA-Einträge des Anbieters (z. B. Parkseite) für diese Namen bitte löschen.\n\n'
  if [[ -t 0 && "${CATCH_DNS_WAIT:-yes}" != "no" ]]; then
    printf 'Warte bis zu 10 Minuten, bis der DNS stimmt (alle 15 s prüfen, Strg+C bricht ab) …\n'
    for _ in {1..40}; do
      sleep 15
      dns_all_ok && { DNS_OK=1; break; }
      printf '  … noch nicht (%s: %s · %s: %s)\n' "$CATCH_DOMAIN" "$(dns_records v4 "$CATCH_DOMAIN" | tr '\n' ' ')" "$CATCH_APP_DOMAIN" "$(dns_records v4 "$CATCH_APP_DOMAIN" | tr '\n' ' ')"
    done
  fi
  if (( DNS_OK )); then
    ok "DNS: $CATCH_DOMAIN und $CATCH_APP_DOMAIN zeigen jetzt hierher."
  else
    warn "DNS ist noch nicht vollständig – alles wird eingerichtet, HTTPS gibt es für die Namen, die schon stimmen."
    warn "Sobald der DNS stimmt, einfach setup.sh erneut starten (geht schnell, nichts geht verloren)."
  fi
fi

# www.<domain> mitbedienen?
SERVER_NAMES="$CATCH_DOMAIN"
WWW="www.$CATCH_DOMAIN"
case "${CATCH_WWW:-auto}" in
  yes) SERVER_NAMES="$CATCH_DOMAIN $WWW" ;;
  no) ;;
  *) if dns_points_here "$WWW" && ! domain_claimed_elsewhere "$WWW" >/dev/null; then SERVER_NAMES="$CATCH_DOMAIN $WWW"; fi ;;
esac

if [[ -n "$FOUND_KEY" ]]; then
  PUSH_PLAN="Firebase-Schlüssel $(basename "$FOUND_KEY") installieren"
elif [[ -s "$CATCH_FIREBASE_KEY" ]]; then
  PUSH_PLAN="vorhandenen Firebase-Schlüssel behalten"
else
  PUSH_PLAN="noch kein Schlüssel gefunden – bleibt vorerst aus"
fi

cat <<EOF

${C_B}Die Einrichtung wird jetzt:${C_0}
  • fehlende Pakete installieren (Nginx, Certbot, PostgreSQL, rsync; Node.js nur falls zu alt);
  • eine eigene PostgreSQL-Datenbank $CATCH_DB anlegen (Anmeldung ohne Passwort per Unix-Socket);
  • Catch nach $CATCH_APP_DIR kopieren, testen, bauen und als Dienst $CATCH_SERVICE auf 127.0.0.1:$CATCH_PORT starten;
  • die Website unter https://$CATCH_DOMAIN veröffentlichen;
  • die Web-App bauen und unter https://$CATCH_APP_DOMAIN veröffentlichen ($( [[ "${CATCH_WEB:-yes}" == no ]] && echo "übersprungen" || echo "dauert einige Minuten"));
  • eigene Nginx-Sites für $SERVER_NAMES und $CATCH_APP_DOMAIN anlegen und HTTPS-Zertifikate holen$( (( DNS_OK )) || printf ' (sobald DNS stimmt)');
  • Android-App: $( apk="$(find_apk)"; [[ -n "$apk" ]] && printf '%s zum Download bereitstellen' "$(basename "$apk")" || printf 'keine catch-….apk in %s gefunden – Download folgt später' "$CATCH_KEY_HOME");
  • Push: $PUSH_PLAN;
  • tägliche Datenbank-Sicherungen nach $CATCH_BACKUP_DIR einrichten.
Website: $SERVER_NAMES · Web-App: $CATCH_APP_DOMAIN · Port: $CATCH_PORT · Zertifikats-E-Mail: ${LETSENCRYPT_EMAIL:-(keine)}
Andere Seiten, ihre Nginx-Sites, Datenbanken, Firewall und Fail2ban bleiben unverändert.
EOF
if [[ "${SETUP_CONFIRM:-}" != "yes" && -t 0 ]]; then
  printf '\nStart in 10 Sekunden … (Strg+C bricht ab)'
  for i in {10..1}; do printf ' %s' "$i"; sleep 1; done
  printf '\n'
fi

# --- 1. Pakete --------------------------------------------------------------------
info "Pakete"
export DEBIAN_FRONTEND=noninteractive
need=()
for pkg in ca-certificates curl nginx certbot python3-certbot-nginx rsync iproute2 postgresql unzip; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need+=("$pkg")
done
if (( ${#need[@]} )); then
  apt-get update
  apt-get install -y "${need[@]}"
fi
ok "Pakete vorhanden"
ensure_node
command -v npm >/dev/null || fail "npm fehlt (gehört normalerweise zu Node.js)."
ensure_service_user
check_free_space /opt 2500

# --- 2. Datenbank -------------------------------------------------------------------
info "Datenbank"
ensure_postgres

# --- 3. App bauen -------------------------------------------------------------------
info "Kopiere Catch nach $CATCH_APP_DIR"
if [[ -d "$CATCH_APP_DIR" && -f "$CATCH_UNIT" ]]; then
  # Bestehende Installation: neue Version daneben bauen, dann umschalten.
  RELEASE_DIR="$CATCH_APP_DIR.new"
  rm -rf "$RELEASE_DIR"
else
  RELEASE_DIR="$CATCH_APP_DIR"
fi
sync_source "$CHECKOUT_DIR" "$RELEASE_DIR"
build_server "$RELEASE_DIR"
WEB_BUILT=0
build_web "$RELEASE_DIR" "$CATCH_APP_DOMAIN" && WEB_BUILT=1
write_deploy_info "$RELEASE_DIR" "$CHECKOUT_DIR"
if [[ "$RELEASE_DIR" != "$CATCH_APP_DIR" ]]; then
  /usr/local/bin/catch-backup "$CATCH_BACKUP_DIR/vor-setup-$(date +%Y%m%d-%H%M%S).dump" || true
  rm -rf "$CATCH_APP_DIR.prev"
  mv "$CATCH_APP_DIR" "$CATCH_APP_DIR.prev"
  mv "$RELEASE_DIR" "$CATCH_APP_DIR"
fi

# --- 4. Dienst ------------------------------------------------------------------------
info "Dienst $CATCH_SERVICE"
install_firebase_key "$CHECKOUT_DIR" || true
write_env_file "$CATCH_DOMAIN" "$VERSION"
write_unit "$CATCH_PORT"
write_helpers
systemctl daemon-reload
systemctl enable "$CATCH_SERVICE.service" >/dev/null
systemctl restart "$CATCH_SERVICE.service"
systemctl enable --now "$CATCH_NAME-backup.timer" >/dev/null
if ! wait_healthy "$CATCH_PORT"; then
  journalctl -u "$CATCH_SERVICE" -n 60 --no-pager || true
  fail "Catch startet nicht. Siehe Log oben."
fi
ok "Catch läuft auf 127.0.0.1:$CATCH_PORT"
if curl -fsS --max-time 20 "http://127.0.0.1:$CATCH_PORT/v1/stops/search?q=Hauptbahnhof" >/dev/null 2>&1; then
  ok "Fahrplandaten erreichbar ($(read_setting MOTIS_URL))"
else
  warn "Fahrplanauskunft ($(read_setting MOTIS_URL)) gerade nicht erreichbar – Suche klappt, sobald sie antwortet."
fi

# --- 5. Website, Web-App, Downloads, Nginx --------------------------------------------
info "Website, Web-App und Downloads"
publish_website "$CATCH_APP_DIR"
if (( WEB_BUILT )); then publish_static "$CATCH_APP_DIR"; else publish_placeholder; fi
# Neueste Android-App von GitHub holen (falls Token eingerichtet) – wird gleich mit bereitgestellt
if [[ -x /usr/local/bin/catch-apk-update ]]; then
  info "Android-App (GitHub Actions)"
  SOURCE_DIR="${SOURCE_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd -P)}" /usr/local/bin/catch-apk-update --fetch-only || warn "APK-Download übersprungen."
fi
install_apk_from_home
# Offline-Fahrpläne: wöchentlicher Timer; beim ersten Mal sofort im Hintergrund bauen
command -v unzip >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable --now "$CATCH_OFFLINE_SERVICE.timer" >/dev/null 2>&1 || true
systemctl enable --now "$CATCH_NAME-monitor.timer" >/dev/null 2>&1 || true
[[ -n "$(read_setting ALERT_EMAIL || true)" ]] || warn "Überwachung läuft – für E-Mail-Alarme: sudo catch-admin alert-email du@example.com"
if [[ -n "$(read_setting OFFLINE_DIR || true)" && ! -f "$CATCH_OFFLINE_DIR/index.json" ]]; then
  systemctl start --no-block "$CATCH_OFFLINE_SERVICE.service" 2>/dev/null && ok "Offline-Fahrpläne werden im Hintergrund gebaut (einige Minuten) – Stand: sudo catch-admin offline"
fi
configure_nginx "$CATCH_PORT" "$SERVER_NAMES" "$CATCH_APP_DOMAIN"

# Firewall: nur prüfen/ergänzen, nie aktivieren oder zurücksetzen.
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ok "UFW: 80 und 443 offen"
fi

# --- 6. HTTPS (je Site ein eigenes Zertifikat) -----------------------------------------
HTTPS_SITE=0; HTTPS_APP=0
# shellcheck disable=SC2086
obtain_certificate "$CATCH_DOMAIN" $SERVER_NAMES || true
obtain_certificate "$CATCH_APP_DOMAIN" "$CATCH_APP_DOMAIN" || true
https_ok "$CATCH_DOMAIN" / && { HTTPS_SITE=1; ok "https://$CATCH_DOMAIN antwortet"; }
https_ok "$CATCH_APP_DOMAIN" / && { HTTPS_APP=1; ok "https://$CATCH_APP_DOMAIN antwortet"; }
(( HTTPS_SITE && HTTPS_APP )) || warn "HTTPS noch nicht für alle Namen aktiv – nach dem DNS-Eintrag setup.sh erneut starten."

cat <<EOF

${C_G}${C_B}Einrichtung fertig.${C_0}
Website:       https://$CATCH_DOMAIN$( (( HTTPS_SITE )) || printf ' (HTTPS folgt, sobald DNS stimmt)')
Web-App:       https://$CATCH_APP_DOMAIN$( (( HTTPS_APP )) || printf ' (HTTPS folgt, sobald DNS stimmt)')$( (( WEB_BUILT )) || printf ' – Platzhalter, Web-Build übersprungen/fehlgeschlagen')
API:           https://$CATCH_DOMAIN/v1/… und https://$CATCH_APP_DOMAIN/v1/…
Android-App:   $( [[ -f "$CATCH_FILES_ROOT/catch.apk" ]] && printf 'https://%s/download/catch.apk' "$CATCH_DOMAIN" || printf 'noch keine – catch-….apk (oder das GitHub-ZIP) nach %s legen und setup.sh/update.sh starten' "$CATCH_KEY_HOME")
Push:          $( [[ -s "$CATCH_FIREBASE_KEY" ]] && echo "Firebase (FCM) aktiv" || echo "noch aus – Schlüssel nach $CATCH_KEY_HOME/ legen und setup.sh erneut starten")
Admin:         https://$CATCH_DOMAIN/admin/ – $( [[ -n "$(read_setting ADMIN_TOTP_SECRET || true)" ]] && echo "2FA eingerichtet" || echo "zuerst 2FA einrichten: sudo catch-admin 2fa")
E-Mails:       $( [[ -n "$(read_setting RESEND_API_KEY || true)" ]] && echo "Resend aktiv (Absender: $(read_setting MAIL_FROM))" || echo "Standard-Mails von Firebase (RESEND_API_KEY in $CATCH_ENV_FILE setzen für eigene Catch-Mails)")

Wichtig in der Firebase-Konsole (Projekt $(read_setting FIREBASE_PROJECT_ID)):
  • Authentication → Sign-in method → E-Mail/Passwort aktivieren
  • Authentication → Settings → Authorized domains → $CATCH_DOMAIN und $CATCH_APP_DOMAIN hinzufügen

Dienst:        systemctl status $CATCH_SERVICE
Logs:          journalctl -u $CATCH_SERVICE -f
Einstellungen: $CATCH_ENV_FILE
Datenbank:     PostgreSQL "$CATCH_DB" (sudo catch-admin psql)
Sicherungen:   täglich nach $CATCH_BACKUP_DIR (manuell: sudo catch-backup)
Verwaltung:    sudo catch-admin   (stats, recent, flags, hide, ban, 2fa, mail-test, apk, firebase-key)
Rechtliches:   Impressum/Datenschutz der Website ergänzen (website/impressum.html, datenschutz.html – markierte Stellen)
Setup-Log:     $CATCH_LOG_FILE

Update später: neue Version holen (git pull oder ZIP entpacken), im Ordner ausführen:
  sudo bash deploy/debian/update.sh
EOF
if [[ -n "$FOUND_KEY" && -s "$CATCH_FIREBASE_KEY" ]]; then
  printf '\n%sTipp:%s Der Schlüssel liegt jetzt geschützt unter %s.\n' "$C_Y$C_B" "$C_0" "$CATCH_FIREBASE_KEY"
  printf '      Die Kopie %s kannst du löschen (oder sicher aufbewahren – sie ist geheim).\n' "$FOUND_KEY"
fi
