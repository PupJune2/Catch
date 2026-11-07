#!/usr/bin/env bash
# Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
# SPDX-License-Identifier: AGPL-3.0-only
# GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
set -Eeuo pipefail
umask 027

usage() {
  cat <<'EOF'
Catch (junify.live) – Update

Neue Version holen und AUS DEM CATCH-ORDNER starten:
  git pull            (oder neue Version als ZIP entpacken)
  sudo bash deploy/debian/update.sh

Ablauf: Die neue Version wird neben der laufenden gebaut und getestet, die
Datenbank gesichert, dann umgeschaltet (wenige Sekunden Ausfall). Startet die
neue Version nicht, wird automatisch zurückgeschaltet.

Optionen:
  --pull       vorher "git pull" im Catch-Ordner ausführen (nur bei git clone)
  --status     installierte Version und Zustand anzeigen
  --rollback   zur vorherigen Version zurück (erneut ausführen = wieder vor)
  --help       diese Hilfe

Umgebungsvariablen: CATCH_WEB=no überspringt den (langsameren) Web-Build.
Ein neuer Firebase-Schlüssel in ~/ (your-firebase-project-firebase-adminsdk-*.json) wird automatisch übernommen.
Andere Seiten auf dem Server werden nicht angefasst.
EOF
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/debian/lib.sh
source "$SCRIPT_DIR/lib.sh"
SOURCE_DIR="${SOURCE_DIR:-$(cd -- "$SCRIPT_DIR/../.." && pwd -P)}"
NEW_DIR="$CATCH_APP_DIR.new"
PREV_DIR="$CATCH_APP_DIR.prev"
FAILED_DIR="$CATCH_APP_DIR.failed"

MODE="update"
PULL=0
for arg in "$@"; do
  case "$arg" in
    --update) ;;
    --pull) PULL=1 ;;
    --status) MODE="status" ;;
    --rollback) MODE="rollback" ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

require_root
[[ -f "$CATCH_UNIT" ]] || fail "Catch ist noch nicht installiert. Zuerst: sudo bash deploy/debian/setup.sh"
PORT="$(installed_port)"; PORT="${PORT:-$CATCH_DEFAULT_PORT}"
DOMAIN="$(site_domain)"; DOMAIN="${DOMAIN:-$CATCH_DEFAULT_DOMAIN}"
APP_DOMAIN="${CATCH_APP_DOMAIN:-$(app_site_domain)}"; APP_DOMAIN="${APP_DOMAIN:-app.$DOMAIN}"
MAIN_NAMES="$(site_names)"; MAIN_NAMES="${MAIN_NAMES:-$DOMAIN}"

show_status() {
  printf '%sCatch%s\n' "$C_B" "$C_0"
  printf '  Installiert: %s (%s, Commit %s)\n' \
    "$(sed -n 's/^version=//p' "$CATCH_APP_DIR/.deploy-info" 2>/dev/null || echo '?')" \
    "$(sed -n 's/^deployed_at=//p' "$CATCH_APP_DIR/.deploy-info" 2>/dev/null)" \
    "$(sed -n 's/^commit=//p' "$CATCH_APP_DIR/.deploy-info" 2>/dev/null)"
  [[ -d "$PREV_DIR" ]] && printf '  Vorherige:   %s\n' "$(sed -n 's/^version=//p' "$PREV_DIR/.deploy-info" 2>/dev/null || echo '?')"
  printf '  Dienst:      %s\n' "$(systemctl is-active "$CATCH_SERVICE" 2>/dev/null || true)"
  if health="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" 2>/dev/null)"; then printf '  Health:      %s\n' "$health"; else printf '  Health:      keine Antwort\n'; fi
  printf '  Website:     https://%s\n' "$DOMAIN"
  printf '  Web-App:     https://%s\n' "$APP_DOMAIN"
  printf '  Datenbank:   %s (%s)\n' "$CATCH_DB" "$( (cd / && runuser -u postgres -- psql -X -tA -c "SELECT pg_size_pretty(pg_database_size('$CATCH_DB'))") 2>/dev/null || echo '?')"
  printf '  Sicherungen: %s Stück in %s\n' "$(find "$CATCH_BACKUP_DIR" -maxdepth 1 -name '*.dump' 2>/dev/null | wc -l)" "$CATCH_BACKUP_DIR"
  printf '  Push (FCM):  %s\n' "$( [[ -s "$CATCH_FIREBASE_KEY" ]] && echo aktiv || echo 'aus (sudo catch-admin firebase-key …)')"
  [[ -f "$CATCH_FILES_ROOT/catch.apk" ]] && printf '  Android-APK: https://%s/download/catch.apk (%s)\n' "$DOMAIN" "$(date -r "$CATCH_FILES_ROOT/catch.apk" '+%d.%m.%Y %H:%M')"
  printf '  Admin:       https://%s/admin/ (%s)\n' "$DOMAIN" "$( [[ -n "$(read_setting ADMIN_TOTP_SECRET || true)" ]] && echo '2FA eingerichtet' || echo '2FA fehlt: sudo catch-admin 2fa')"
  printf '  E-Mails:     %s\n' "$( [[ -n "$(read_setting RESEND_API_KEY || true)" ]] && echo "Resend ($(read_setting MAIL_FROM))" || echo 'Standard-Mails von Firebase')"
  return 0
}

if [[ "$MODE" == "status" ]]; then show_status; exit 0; fi

if (( PULL )); then
  [[ -d "$SOURCE_DIR/.git" ]] || fail "$SOURCE_DIR ist kein git-Checkout – --pull geht nur nach git clone."
  owner="$(stat -c %U "$SOURCE_DIR")"
  info "git pull in $SOURCE_DIR (als $owner)"
  runuser -u "$owner" -- git -C "$SOURCE_DIR" pull --ff-only
  # Das Skript selbst kann sich geändert haben → mit der neuen Fassung weitermachen.
  rest=()
  for arg in "$@"; do [[ "$arg" == "--pull" ]] || rest+=("$arg"); done
  exec bash "$SOURCE_DIR/deploy/debian/update.sh" "${rest[@]}"
fi

acquire_lock
start_log update
trap 'status=$?; printf "\n%sUpdate bei Zeile %s abgebrochen (Code %s).%s Die laufende Version wurde nicht verändert, außer es steht oben anders. Log: %s\n" "$C_R$C_B" "$LINENO" "$status" "$C_0" "${CATCH_LOG_FILE:-}" >&2' ERR

switch_to() { # switch_to QUELLE: QUELLE wird aktiv, aktive Version wird .prev
  local from="$1" tmp="$CATCH_APP_DIR.swap"
  rm -rf "$tmp"
  mv "$CATCH_APP_DIR" "$tmp"
  mv "$from" "$CATCH_APP_DIR"
  rm -rf "$PREV_DIR"
  mv "$tmp" "$PREV_DIR"
}

if [[ "$MODE" == "rollback" ]]; then
  [[ -d "$PREV_DIR" ]] || fail "Keine vorherige Version vorhanden."
  info "Schalte auf die vorherige Version zurück"
  switch_to "$PREV_DIR"
  write_unit "$PORT"
  systemctl daemon-reload
  systemctl restart "$CATCH_SERVICE"
  wait_healthy "$PORT" || fail "Die vorherige Version startet nicht. Logs: journalctl -u $CATCH_SERVICE"
  [[ -s "$CATCH_APP_DIR/app/dist/index.html" ]] && publish_static "$CATCH_APP_DIR"
  ok "Zurückgeschaltet."
  warn "Hinweis: Falls die neuere Version die Datenbank erweitert hatte, liegt eine Sicherung von vor dem Update in $CATCH_BACKUP_DIR."
  show_status
  exit 0
fi


require_source_tree "$SOURCE_DIR"
[[ "$SOURCE_DIR" != "$CATCH_APP_DIR" ]] || fail "Bitte update.sh aus dem Catch-Quellordner starten (git clone / entpackte ZIP), nicht aus $CATCH_APP_DIR."
NEW_VERSION="$(source_version "$SOURCE_DIR")"
OLD_VERSION="$(sed -n 's/^version=//p' "$CATCH_APP_DIR/.deploy-info" 2>/dev/null || echo '?')"
info "Update $OLD_VERSION → $NEW_VERSION"

ensure_node
ensure_service_user
check_free_space /opt 2500
ensure_postgres

# 1. Neue Version daneben bauen und testen – die laufende bleibt online.
rm -rf "$NEW_DIR" "$FAILED_DIR"
sync_source "$SOURCE_DIR" "$NEW_DIR"
build_server "$NEW_DIR"
WEB_BUILT=0
build_web "$NEW_DIR" "$APP_DOMAIN" && WEB_BUILT=1
# Ohne neuen Web-Build die bisherige Web-Version übernehmen (für ein späteres --rollback)
if (( ! WEB_BUILT )) && [[ -d "$CATCH_APP_DIR/app/dist" ]]; then
  rsync -a "$CATCH_APP_DIR/app/dist/" "$NEW_DIR/app/dist/"
  chown -R "$CATCH_USER:$CATCH_GROUP" "$NEW_DIR/app/dist"
fi
write_deploy_info "$NEW_DIR" "$SOURCE_DIR"

# 2. Datenbank sichern (falls die neue Version das Schema erweitert).
info "Sichere die Datenbank"
/usr/local/bin/catch-backup "$CATCH_BACKUP_DIR/vor-update-$OLD_VERSION-$(date +%Y%m%d-%H%M%S).dump"

# 3. Umschalten.
info "Schalte um"
switch_to "$NEW_DIR"
install_firebase_key "$SOURCE_DIR" || true
write_env_file "$DOMAIN" "$NEW_VERSION"
write_unit "$PORT"
write_helpers
systemctl daemon-reload
systemctl restart "$CATCH_SERVICE"

if ! wait_healthy "$PORT"; then
  warn "Die neue Version startet nicht – schalte automatisch zurück."
  journalctl -u "$CATCH_SERVICE" -n 40 --no-pager || true
  mv "$CATCH_APP_DIR" "$FAILED_DIR"
  mv "$PREV_DIR" "$CATCH_APP_DIR"
  write_unit "$PORT"
  systemctl daemon-reload
  systemctl restart "$CATCH_SERVICE"
  wait_healthy "$PORT" && ok "Alte Version läuft wieder." || warn "Auch die alte Version antwortet nicht – bitte journalctl -u $CATCH_SERVICE prüfen."
  fail "Update fehlgeschlagen. Die defekte Version liegt in $FAILED_DIR."
fi
ok "Neue Version läuft"
# Neueste Android-App von GitHub holen (falls Token eingerichtet) – wird gleich mit bereitgestellt
if [[ -x /usr/local/bin/catch-apk-update ]]; then
  info "Android-App (GitHub Actions)"
  SOURCE_DIR="$SOURCE_DIR" /usr/local/bin/catch-apk-update --fetch-only || warn "APK-Download übersprungen."
fi
publish_website "$CATCH_APP_DIR"
if (( WEB_BUILT )); then publish_static "$CATCH_APP_DIR"; fi
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

# 4. Nginx: Regeln auffrischen, fehlende Site (z. B. neue app.-Subdomain) anlegen.
#    Site-Dateien mit Certbot-Zeilen bleiben erhalten.
if command -v nginx >/dev/null; then
  for f in "$CATCH_NGINX_API_SNIPPET" "$CATCH_NGINX_SNIPPET" "$CATCH_NGINX_APP_SNIPPET"; do
    [[ -f "$f" ]] && cp -a "$f" "$f.bak"
  done
  had_app_link=0; [[ -L "$CATCH_NGINX_APP_LINK" ]] && had_app_link=1
  if ( configure_nginx "$PORT" "$MAIN_NAMES" "$APP_DOMAIN" ); then
    # Neue Sites ohne Zertifikat bekommen eins, sobald ihr DNS hierher zeigt.
    # shellcheck disable=SC2086
    grep -q 'managed by Certbot' "$CATCH_NGINX_SITE" 2>/dev/null || obtain_certificate "$DOMAIN" $MAIN_NAMES || true
    grep -q 'managed by Certbot' "$CATCH_NGINX_APP_SITE" 2>/dev/null || obtain_certificate "$APP_DOMAIN" "$APP_DOMAIN" || true
  else
    for f in "$CATCH_NGINX_API_SNIPPET" "$CATCH_NGINX_SNIPPET" "$CATCH_NGINX_APP_SNIPPET"; do
      [[ -f "$f.bak" ]] && mv -f "$f.bak" "$f"
    done
    # Zustand von vor dem Update wiederherstellen (Haupt-Site bleibt online)
    ln -sfn "$CATCH_NGINX_SITE" "$CATCH_NGINX_LINK"
    (( had_app_link )) && ln -sfn "$CATCH_NGINX_APP_SITE" "$CATCH_NGINX_APP_LINK"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    warn "Nginx-Konfiguration fehlerhaft – vorherige Regeln wiederhergestellt (Catch läuft weiter)."
  fi
fi

https_ok "$DOMAIN" / && ok "https://$DOMAIN antwortet"
https_ok "$APP_DOMAIN" / && ok "https://$APP_DOMAIN antwortet"

printf '\n%s%sUpdate fertig.%s Zurück zur vorherigen Version: sudo bash deploy/debian/update.sh --rollback\n' "$C_G" "$C_B" "$C_0"
show_status
