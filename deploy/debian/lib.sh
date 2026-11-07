#!/usr/bin/env bash
# Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
# SPDX-License-Identifier: AGPL-3.0-only
# GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
# Gemeinsame Helfer für deploy/debian/setup.sh und update.sh von Catch (junify.live).
# Wird nur eingebunden (source), nie direkt ausgeführt. Alles hier ist idempotent.
#
# WICHTIG: Catch läuft neben anderen Seiten (andere Apps) auf demselben
# Server. Alle Namen, Ports, Ordner, Sperren und die Datenbank sind deshalb eigene
# (catch-junify …); Dateien anderer Seiten werden nie angefasst.

CATCH_NAME="catch-junify"
CATCH_SERVICE="$CATCH_NAME"
CATCH_UNIT="/etc/systemd/system/$CATCH_SERVICE.service"
CATCH_USER="catchjunify"          # Linux-Dienstnutzer UND PostgreSQL-Rolle (Anmeldung per Unix-Socket, kein Passwort)
CATCH_GROUP="catchjunify"
CATCH_DB="catch_junify"
CATCH_APP_DIR="/opt/$CATCH_NAME"
CATCH_DATA_DIR="/var/lib/$CATCH_NAME"
CATCH_BACKUP_DIR="/var/backups/$CATCH_NAME"
CATCH_ETC="/etc/$CATCH_NAME"
CATCH_ENV_FILE="$CATCH_ETC/catch.env"
CATCH_FIREBASE_KEY="$CATCH_ETC/firebase-service-account.json"   # optional: Push direkt über Firebase (FCM)
CATCH_STATIC_ROOT="/var/www/$CATCH_NAME"                        # Web-App (app.junify.live)
CATCH_SITE_ROOT="/var/www/$CATCH_NAME-site"                     # Website (junify.live)
CATCH_FILES_ROOT="/var/www/$CATCH_NAME-files"                   # Downloads (Android-APK)
# Haupt-Domain: Website + API + Downloads
CATCH_NGINX_SITE="/etc/nginx/sites-available/$CATCH_NAME"
CATCH_NGINX_LINK="/etc/nginx/sites-enabled/$CATCH_NAME"
CATCH_NGINX_SNIPPET="/etc/nginx/snippets/$CATCH_NAME.conf"
# app.-Subdomain: Web-App + API + Downloads
CATCH_NGINX_APP_SITE="/etc/nginx/sites-available/$CATCH_NAME-app"
CATCH_NGINX_APP_LINK="/etc/nginx/sites-enabled/$CATCH_NAME-app"
CATCH_NGINX_APP_SNIPPET="/etc/nginx/snippets/$CATCH_NAME-app.conf"
# gemeinsame Regeln (API, WebSocket, Downloads) für beide Sites
CATCH_NGINX_API_SNIPPET="/etc/nginx/snippets/$CATCH_NAME-api.conf"
CATCH_LOG_DIR="/var/log/$CATCH_NAME"
CATCH_SWAPFILE="/swapfile-$CATCH_NAME"
CATCH_DEFAULT_PORT=8095            # 8080 = Hauptportal, 8090 = andere App
CATCH_DEFAULT_DOMAIN="junify.live"
CATCH_FIREBASE_PROJECT="your-firebase-project"
# Hier sucht setup.sh/update.sh automatisch nach dem Firebase-Service-Account (neueste Datei gewinnt)
# und nach der Android-APK: im Home-Ordner der Person, die "sudo bash …" aufruft (sonst /root).
# Fest vorgeben: CATCH_KEY_HOME=/pfad sudo -E bash deploy/debian/update.sh
if [[ -z "${CATCH_KEY_HOME:-}" ]]; then
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    CATCH_KEY_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  fi
  CATCH_KEY_HOME="${CATCH_KEY_HOME:-/root}"
fi
CATCH_KEY_PATTERN="your-firebase-project-firebase-adminsdk-*.json"
# Android-App aus GitHub Actions: catch-….apk oder das Artefakt-ZIP catch-android*.zip
CATCH_APK_PATTERNS=("catch-*.apk" "catch-android*.zip")  # inkl. automatisch geladener catch-android-buildNN.zip
# Admin-Bereich (https://DOMAIN/admin/): Firebase-UID(s), die hinein dürfen – plus 2FA-Code.
# Steht nicht im Code, sondern nur in catch.env:  sudo catch-admin admin-uid <Firebase-UID>
CATCH_DEFAULT_ADMIN_UIDS=""
CATCH_DEFAULT_MAIL_FROM="Catch <noreply@junify.live>"
# Offline-Fahrpläne für die App (wöchentlich aus dem GTFS-Feed von gtfs.de, DELFI e.V., CC BY 4.0)
CATCH_OFFLINE_DIR="/var/lib/catch-junify/offline"
CATCH_GTFS_DIR="/var/lib/catch-junify/gtfs"
CATCH_OFFLINE_SERVICE="catch-junify-offline"
# Android-App automatisch von GitHub Actions holen (Artefakt "catch-android")
CATCH_GITHUB_REPO="PupJune2/Catch-"
CATCH_GITHUB_WORKFLOW="android-app.yml"
CATCH_GITHUB_TOKEN_FILE="/etc/catch-junify/github-token"
CATCH_APK_MARKER="/var/lib/catch-junify/.apk-build"
# Resend-Key der anderen App auf dem Server (gleiches Resend-Konto) – wird übernommen, falls Catch noch keinen hat
SHARED_MAIL_ENV_FILE="/etc/other-app/app.env"
CATCH_NODE_MIN="24.12.0"
CATCH_NODE_MAJOR=24

# ---------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_B=$'\e[1m' C_R=$'\e[31m' C_G=$'\e[32m' C_Y=$'\e[33m' C_C=$'\e[36m' C_0=$'\e[0m'
else
  C_B='' C_R='' C_G='' C_Y='' C_C='' C_0=''
fi
fail() { printf '%sFEHLER:%s %s\n' "$C_R$C_B" "$C_0" "$*" >&2; exit 1; }
info() { printf '\n%s==>%s %s%s%s\n' "$C_C$C_B" "$C_0" "$C_B" "$*" "$C_0"; }
ok()   { printf '  %s✓%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_Y$C_B" "$C_0" "$*" >&2; }

start_log() {
  local name="$1"
  install -d -o root -g root -m 0750 "$CATCH_LOG_DIR"
  CATCH_LOG_FILE="$CATCH_LOG_DIR/$name-$(date +%Y%m%d-%H%M%S).log"
  exec > >(tee -a "$CATCH_LOG_FILE") 2>&1
  printf 'Protokoll: %s\n' "$CATCH_LOG_FILE"
  find "$CATCH_LOG_DIR" -maxdepth 1 -name "$name-*.log" -type f -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm -f --
}

# Eigene Sperre – blockiert keine Skripte anderer Seiten und umgekehrt.
acquire_lock() {
  exec 9>/run/$CATCH_NAME-deploy.lock
  flock -n 9 || fail "Ein anderes setup.sh/update.sh von Catch läuft gerade. Bitte warten."
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Bitte als root ausführen (z. B.: sudo bash $0)."
}

require_debian() {
  [[ -f /etc/os-release ]] || fail "Betriebssystem nicht erkennbar."
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "debian" && "${VERSION_ID:-}" =~ ^(12|13)$ ]] || fail "Unterstützt werden Debian 12 (bookworm) und 13 (trixie)."
}

require_source_tree() {
  local dir="$1"
  [[ -f "$dir/server/package.json" && -f "$dir/server/src/index.ts" && -f "$dir/app/package.json" && -f "$dir/website/index.html" && -f "$dir/deploy/debian/lib.sh" ]] ||
    fail "Kein Catch-Quellordner unter $dir. Bitte das Skript aus dem entpackten/geklonten Catch-Ordner starten."
  grep -q '"name": "catch-server"' "$dir/server/package.json" || fail "$dir ist nicht Catch."
}

source_version() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/server/package.json" | head -1; }

# ---------------------------------------------------------------------------
# Node.js (gemeinsam mit den anderen Seiten: bleibt in Version 22.x)
# ---------------------------------------------------------------------------
version_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]; }
node_version() { node -p 'process.versions.node' 2>/dev/null || printf '0.0.0'; }

ensure_node() {
  local current
  current="$(node_version)"
  if version_ge "$current" "$CATCH_NODE_MIN"; then
    ok "Node.js v$current"
    return 0
  fi
  # Wer (noch) bei Node 22 bleiben will: CATCH_NODE_UPGRADE=no – Catch läuft auch damit.
  if [[ "${CATCH_NODE_UPGRADE:-yes}" == "no" ]] && version_ge "$current" "22.13.0"; then
    warn "Node.js v$current – Update auf $CATCH_NODE_MAJOR übersprungen (CATCH_NODE_UPGRADE=no)."
    return 0
  fi
  local others=()
  if [[ "$current" != "0.0.0" ]]; then
    warn "Node.js v$current wird auf $CATCH_NODE_MAJOR.x aktualisiert (getestet mit Catch und der anderen App auf dem Server)."
    # Andere laufende Node-Dienste (z. B. andere Apps) merken – sie werden danach neu gestartet und geprüft
    local svc exec
    while read -r svc _; do
      [[ "$svc" == "$CATCH_SERVICE.service" || -z "$svc" ]] && continue
      exec="$(systemctl show -p ExecStart --value "$svc" 2>/dev/null || true)"
      [[ "$exec" == *"/node "* || "$exec" == *"bin/node;"* || "$exec" == *"/node;"* ]] && others+=("$svc")
    done < <(systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null)
  fi
  info "Installiere/aktualisiere Node.js $CATCH_NODE_MAJOR.x"
  if ! apt-cache policy nodejs 2>/dev/null | grep -q "deb.nodesource.com/node_${CATCH_NODE_MAJOR}.x"; then
    # Auch bei vorhandener NodeSource-Quelle für eine ältere Version: Quelle auf $CATCH_NODE_MAJOR.x umstellen
    curl -fsSL "https://deb.nodesource.com/setup_${CATCH_NODE_MAJOR}.x" -o /tmp/catch-nodesource-setup.sh
    bash /tmp/catch-nodesource-setup.sh
    rm -f /tmp/catch-nodesource-setup.sh
  else
    apt-get update
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  current="$(node_version)"
  version_ge "$current" "$CATCH_NODE_MIN" || fail "Node.js v$CATCH_NODE_MIN oder neuer wird benötigt, gefunden: v$current."
  ok "Node.js v$current"
  local s
  for s in "${others[@]}"; do
    systemctl restart "$s" || true
    sleep 3
    if systemctl is-active --quiet "$s"; then ok "$s läuft mit Node v$current weiter"; else warn "$s startet nach dem Node-Update nicht – bitte prüfen: journalctl -u $s -n 50"; fi
  done
}

ensure_service_user() {
  getent group "$CATCH_GROUP" >/dev/null || groupadd --system "$CATCH_GROUP"
  if ! id "$CATCH_USER" >/dev/null 2>&1; then
    useradd --system --gid "$CATCH_GROUP" --home-dir "$CATCH_DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$CATCH_USER"
  fi
  install -d -o "$CATCH_USER" -g "$CATCH_GROUP" -m 0750 "$CATCH_DATA_DIR"
  install -d -o root -g root -m 0750 "$CATCH_BACKUP_DIR"
}

# Der Web-Build (Expo/Metro) braucht ~1,5 GiB Speicher. Kleine Server bekommen eine Swap-Datei,
# damit der Build nicht mittendrin abbricht. Vorhandene Swap-Dateien anderer Seiten zählen mit.
ensure_build_memory() {
  local mem_kib swap_kib avail_kib
  mem_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kib="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
  (( mem_kib + swap_kib >= 2 * 1024 * 1024 )) && return 0
  if [[ -f "$CATCH_SWAPFILE" ]]; then
    swapon "$CATCH_SWAPFILE" 2>/dev/null || true
    return 0
  fi
  avail_kib="$(df -Pk / | awk 'NR==2 {print $4}')"
  if (( avail_kib < 3 * 1024 * 1024 )); then
    warn "Weniger als 2 GiB RAM+Swap und zu wenig Platz für eine Swap-Datei – der Web-Build könnte abbrechen."
    return 0
  fi
  info "Lege 2 GiB Swap an (Server hat $(( mem_kib / 1024 )) MiB RAM, $(( swap_kib / 1024 )) MiB Swap)"
  fallocate -l 2G "$CATCH_SWAPFILE" 2>/dev/null || dd if=/dev/zero of="$CATCH_SWAPFILE" bs=1M count=2048 status=none
  chmod 0600 "$CATCH_SWAPFILE"
  mkswap "$CATCH_SWAPFILE" >/dev/null
  swapon "$CATCH_SWAPFILE"
  grep -q "^$CATCH_SWAPFILE " /etc/fstab || echo "$CATCH_SWAPFILE none swap sw 0 0" >> /etc/fstab
  ok "Swap aktiv"
}

check_free_space() { # check_free_space PFAD MiB
  local avail_kib
  avail_kib="$(df -Pk "$1" | awk 'NR==2 {print $4}')"
  (( avail_kib >= $2 * 1024 )) || fail "Zu wenig Speicherplatz unter $1: mindestens $2 MiB frei nötig."
}

# ---------------------------------------------------------------------------
# PostgreSQL – eigene Rolle + eigene Datenbank, andere Datenbanken bleiben unberührt.
# Anmeldung per Unix-Socket ("peer"): der Dienstnutzer catchjunify darf nur in seine DB.
# ---------------------------------------------------------------------------
pg() { (cd / && runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -tA "$@"); }

ensure_postgres() {
  if ! dpkg -s postgresql >/dev/null 2>&1; then
    info "Installiere PostgreSQL"
    DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql
  fi
  systemctl enable --now postgresql >/dev/null 2>&1 || true
  local i
  for i in $(seq 1 20); do
    pg -c 'SELECT 1' >/dev/null 2>&1 && break
    (( i == 20 )) && fail "PostgreSQL antwortet nicht (systemctl status postgresql)."
    sleep 1
  done
  if [[ "$(pg -c "SELECT 1 FROM pg_roles WHERE rolname = '$CATCH_USER'")" != "1" ]]; then
    pg -c "CREATE ROLE $CATCH_USER LOGIN" >/dev/null
    ok "PostgreSQL-Rolle $CATCH_USER angelegt"
  fi
  if [[ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = '$CATCH_DB'")" != "1" ]]; then
    (cd / && runuser -u postgres -- createdb --owner="$CATCH_USER" --encoding=UTF8 --template=template0 "$CATCH_DB")
    ok "Datenbank $CATCH_DB angelegt"
  fi
  # Verbindung als Dienstnutzer über den Socket prüfen (pg_hba "local … peer" ist Debian-Standard)
  if ! (cd / && runuser -u "$CATCH_USER" -- psql -X -tA -d "$CATCH_DB" -c 'SELECT 1') >/dev/null 2>&1; then
    fail "Der Dienstnutzer $CATCH_USER kann sich nicht per Unix-Socket an PostgreSQL anmelden. In pg_hba.conf muss 'local all all peer' (Debian-Standard) aktiv sein."
  fi
  ok "PostgreSQL bereit (Datenbank $CATCH_DB)"
}

database_url() { printf 'postgresql://%s@/%s?host=/var/run/postgresql' "$CATCH_USER" "$CATCH_DB"; }

# ---------------------------------------------------------------------------
# Quellcode kopieren & bauen
# ---------------------------------------------------------------------------
sync_source() {
  local from="$1" to="$2"
  install -d -o root -g root -m 0755 "$to"
  rsync -a --delete \
    --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='.expo' \
    --exclude='.env' --exclude='.env.*' --exclude='*.key' --exclude='*.jks' --exclude='*.keystore' \
    --exclude='*firebase-adminsdk*.json' --exclude='*service-account*.json' \
    --exclude='/app/android' --exclude='/app/ios' --exclude='/.github' --exclude='/docs/screenshots' \
    --exclude='.deploy-info' \
    "$from/" "$to/"
  chown -R "$CATCH_USER:$CATCH_GROUP" "$to"
}

as_service_user() { # as_service_user ORDNER BEFEHL
  local dir="$1"; shift
  runuser -u "$CATCH_USER" -- env HOME="$CATCH_DATA_DIR" npm_config_cache="$CATCH_DATA_DIR/.npm" \
    TMPDIR="$CATCH_DATA_DIR" NEXT_TELEMETRY_DISABLED=1 EXPO_NO_TELEMETRY=1 CI=1 \
    bash -c "cd '$dir' && $*"
}

# Server: Abhängigkeiten, Selbsttest (Unit-Tests), Build, Dev-Abhängigkeiten entfernen.
build_server() {
  local dir="$1/server"
  info "Server: Abhängigkeiten"
  as_service_user "$dir" "npm ci --no-audit --no-fund"
  info "Server: Selbsttest"
  as_service_user "$dir" "npm test" || fail "Der Selbsttest ist fehlgeschlagen – nichts wurde umgestellt."
  info "Server: Build"
  as_service_user "$dir" "npm run build"
  [[ -s "$dir/dist/index.js" && -f "$dir/dist/db/migrations/001_init.sql" ]] || fail "Build hat dist/index.js nicht erzeugt."
  as_service_user "$dir" "npm prune --omit=dev --no-audit --no-fund >/dev/null"
  ok "Server gebaut"
}

# Web-Version der App (Expo → statische Dateien). Schlägt sie fehl, läuft die API trotzdem.
# Rückgabe 0 = gebaut, 1 = übersprungen/fehlgeschlagen.
build_web() {
  local dir="$1/app" domain="$2"
  if [[ "${CATCH_WEB:-yes}" == "no" ]]; then
    warn "Web-Version übersprungen (CATCH_WEB=no)."
    return 1
  fi
  ensure_build_memory
  info "Web-App: Abhängigkeiten (dauert beim ersten Mal ein paar Minuten)"
  if ! as_service_user "$dir" "npm ci --no-audit --no-fund"; then
    warn "npm ci für die Web-App fehlgeschlagen – Web-Version wird nicht aktualisiert."
    return 1
  fi
  info "Web-App: Build für https://$domain"
  if ! as_service_user "$dir" "EXPO_PUBLIC_API_URL='https://$domain' NODE_OPTIONS=--max-old-space-size=1536 npx expo export --platform web --output-dir dist"; then
    warn "Web-Build fehlgeschlagen – Web-Version wird nicht aktualisiert (API läuft trotzdem)."
    rm -rf "$dir/node_modules"
    return 1
  fi
  rm -rf "$dir/node_modules"   # ~600 MB, wird nur zum Bauen gebraucht
  [[ -s "$dir/dist/index.html" ]] || { warn "Web-Build ohne index.html."; return 1; }
  ok "Web-App gebaut"
  return 0
}

publish_static() { # publish_static RELEASE_DIR
  local src="$1/app/dist"
  install -d -o root -g www-data -m 0755 "$CATCH_STATIC_ROOT"
  rsync -a --delete "$src/" "$CATCH_STATIC_ROOT/"
  chown -R root:www-data "$CATCH_STATIC_ROOT"
  find "$CATCH_STATIC_ROOT" -type d -exec chmod 0755 {} +
  find "$CATCH_STATIC_ROOT" -type f -exec chmod 0644 {} +
  ok "Web-Version veröffentlicht ($CATCH_STATIC_ROOT)"
}

# Website (junify.live) – reines HTML/CSS, kein Build nötig.
publish_website() { # publish_website RELEASE_DIR
  local src="$1/website"
  [[ -f "$src/index.html" ]] || { warn "Kein website/-Ordner gefunden – Website nicht aktualisiert."; return 0; }
  install -d -o root -g www-data -m 0755 "$CATCH_SITE_ROOT"
  rsync -a --delete "$src/" "$CATCH_SITE_ROOT/"
  chown -R root:www-data "$CATCH_SITE_ROOT"
  find "$CATCH_SITE_ROOT" -type d -exec chmod 0755 {} +
  find "$CATCH_SITE_ROOT" -type f -exec chmod 0644 {} +
  ok "Website veröffentlicht ($CATCH_SITE_ROOT)"
}

# Platzhalterseite, falls (noch) keine Web-Version gebaut wurde.
publish_placeholder() {
  [[ -s "$CATCH_STATIC_ROOT/index.html" ]] && return 0
  install -d -o root -g www-data -m 0755 "$CATCH_STATIC_ROOT"
  cat > "$CATCH_STATIC_ROOT/index.html" <<'HTML'
<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catch</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16203A;color:#fff;font:16px system-ui,sans-serif;text-align:center}
a{display:inline-block;margin-top:20px;padding:14px 26px;border-radius:999px;background:#C7E8A5;color:#14203A;font-weight:700;text-decoration:none}p{color:#8C97B2}</style></head>
<body><main><h1>Catch</h1><p>Wissen, was auf deiner Linie los ist.</p><a href="/download/catch.apk">Android-App laden</a></main></body></html>
HTML
  chmod 0644 "$CATCH_STATIC_ROOT/index.html"
}

write_deploy_info() {
  local dir="$1" source="$2" commit=""
  if [[ -d "$source/.git" ]] && command -v git >/dev/null; then
    commit="$(git -c safe.directory="$source" -C "$source" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  cat > "$dir/.deploy-info" <<EOF
version=$(source_version "$dir")
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
source=$source
commit=${commit:-unbekannt}
EOF
  chown "$CATCH_USER:$CATCH_GROUP" "$dir/.deploy-info"
}

# ---------------------------------------------------------------------------
# Laufzeit-Einstellungen
# ---------------------------------------------------------------------------
read_setting() { # read_setting KEY → Wert aus catch.env
  [[ -f "$CATCH_ENV_FILE" ]] || return 1
  local line
  line="$(grep -E "^$1=" "$CATCH_ENV_FILE" | tail -1)" || return 1
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

# write_env_file DOMAIN – vorhandene Werte bleiben erhalten.
write_env_file() {
  local domain="$1" version="$2" public_url project motis ua log_level cors expo_token fb_key
  public_url="$(read_setting CATCH_PUBLIC_URL || true)"; public_url="${public_url:-https://$domain}"
  project="$(read_setting FIREBASE_PROJECT_ID || true)"; project="${project:-$CATCH_FIREBASE_PROJECT}"
  motis="$(read_setting MOTIS_URL || true)"; motis="${motis:-https://api.transitous.org}"
  # User-Agent für Transitous: App, Version und Kontakt (Website + Mail) – deren Nutzungsbedingungen
  local contact; contact="$(read_setting CONTACT_EMAIL || true)"
  ua="$(read_setting TRANSIT_USER_AGENT || true)"
  if [[ -z "$ua" || "$ua" == catch-junify/* ]]; then ua="catch-junify/$version (+$public_url${contact:+; $contact})"; fi
  log_level="$(read_setting LOG_LEVEL || true)"; log_level="${log_level:-info}"
  cors="$(read_setting CORS_ORIGIN || true)"; cors="${cors:-$public_url,https://www.$domain}"
  [[ "$cors" == *"https://app.$domain"* || "$cors" == "*" ]] || cors="$cors,https://app.$domain"
  expo_token="$(read_setting EXPO_ACCESS_TOKEN || true)"
  local admin_uids totp allow_ips resend mail_from
  admin_uids="$(read_setting ADMIN_UIDS || true)"; admin_uids="${admin_uids:-$CATCH_DEFAULT_ADMIN_UIDS}"
  totp="$(read_setting ADMIN_TOTP_SECRET || true)"
  allow_ips="$(read_setting ADMIN_ALLOW_IPS || true)"
  resend="$(read_setting RESEND_API_KEY || true)"
  if [[ -z "$resend" && -f "$SHARED_MAIL_ENV_FILE" ]]; then
    resend="$(sed -n 's/^SHARED_RESEND_API_KEY=//p' "$SHARED_MAIL_ENV_FILE" | tail -1 | tr -d '"')"
    [[ -n "$resend" ]] && ok "Resend-Key von der anderen App auf dem Server übernommen (E-Mails für \"Passwort vergessen\")"
  fi
  mail_from="$(read_setting MAIL_FROM || true)"; mail_from="${mail_from:-$CATCH_DEFAULT_MAIL_FROM}"
  local reply_to contact; reply_to="$(read_setting MAIL_REPLY_TO || true)"; contact="$(read_setting CONTACT_EMAIL || true)"
  local webhook_secret inbound_key; webhook_secret="$(read_setting RESEND_WEBHOOK_SECRET || true)"; inbound_key="$(read_setting RESEND_INBOUND_API_KEY || true)"
  # Standard: an. Wer OFFLINE_DIR bewusst leer setzt, schaltet die Funktion ab – das bleibt so.
  local alert_email; alert_email="$(read_setting ALERT_EMAIL || true)"
  local offline_dir="$CATCH_OFFLINE_DIR"
  if [[ -f "$CATCH_ENV_FILE" ]] && grep -q '^OFFLINE_DIR=' "$CATCH_ENV_FILE"; then offline_dir="$(read_setting OFFLINE_DIR || true)"; fi
  fb_key=""
  [[ -s "$CATCH_FIREBASE_KEY" ]] && fb_key="$CATCH_FIREBASE_KEY"

  install -d -o root -g "$CATCH_GROUP" -m 0750 "$CATCH_ETC"
  local tmp="$CATCH_ENV_FILE.tmp"
  cat > "$tmp" <<EOF
# Catch – Laufzeit-Einstellungen.
# Verwaltet von deploy/debian/setup.sh und update.sh: eigene Änderungen bleiben erhalten.
# Nach dem Ändern: systemctl restart $CATCH_SERVICE
CATCH_PUBLIC_URL=$public_url
DATABASE_URL=$(database_url)
AUTH_MODE=firebase
FIREBASE_PROJECT_ID=$project
# Fahrplandaten: Transitous (öffentlich) oder eigene MOTIS-Instanz (docs/MOTIS.md)
MOTIS_URL=$motis
TRANSIT_USER_AGENT="$ua"
CORS_ORIGIN=$cors
LOG_LEVEL=$log_level

# Admin-Bereich https://$domain/admin/ – nur diese Firebase-UID(s), zusätzlich 2FA-Code.
# 2FA einrichten/anzeigen: sudo catch-admin 2fa   ·   Optional nur bestimmte IPs: ADMIN_ALLOW_IPS=1.2.3.4,10.0.0.0/8
ADMIN_UIDS=$admin_uids
ADMIN_TOTP_SECRET=$totp
ADMIN_ALLOW_IPS=$allow_ips

# E-Mails ("Passwort vergessen") über resend.com – die Absender-Domain muss bei Resend verifiziert sein.
# Ohne Key schickt die App die Standard-Mail von Firebase. Test: sudo catch-admin mail-test du@example.com
RESEND_API_KEY=$resend
MAIL_FROM="$mail_from"
# Antworten auf Catch-Mails (Moderations-Entscheidungen, Feedback-Antworten) gehen an diese Adresse;
# CONTACT_EMAIL wird in Mails als Kontakt für Widersprüche genannt. Setzen: sudo catch-admin contact-email …
MAIL_REPLY_TO=$reply_to
CONTACT_EMAIL=$contact
# Empfang (Resend Receiving → Admin-Bereich "Posteingang"): Webhook https://$domain/v1/mail/inbound,
# Ereignis email.received. Setzen: sudo catch-admin resend-webhook  ·  sudo catch-admin resend-inbound-key
RESEND_WEBHOOK_SECRET=$webhook_secret
RESEND_INBOUND_API_KEY=$inbound_key

# Offline-Fahrpläne für die App – gebaut von $CATCH_OFFLINE_SERVICE.timer (wöchentlich).
# Leer lassen = Funktion aus. Eigene Städte: /etc/catch-junify/offline-regions.json (siehe docs/OFFLINE.md)
OFFLINE_DIR=$offline_dir

# Überwachung: E-Mail an diese Adresse, wenn API, HTTPS, Zertifikat, Speicher, Sicherung oder
# Offline-Bau Probleme machen (über Resend). Setzen: sudo catch-admin alert-email du@example.com
ALERT_EMAIL=$alert_email
EOF
  [[ -n "$fb_key" ]] && printf '# Push direkt über Firebase Cloud Messaging (Android-App ohne Expo-Konto)\nFIREBASE_SERVICE_ACCOUNT_FILE=%s\n' "$fb_key" >> "$tmp"
  [[ -n "$expo_token" ]] && printf 'EXPO_ACCESS_TOKEN=%s\n' "$expo_token" >> "$tmp"
  if [[ -f "$CATCH_ENV_FILE" ]]; then
    local extra
    extra="$(grep -E '^[A-Z][A-Z0-9_]*=' "$CATCH_ENV_FILE" | grep -vE '^(CATCH_PUBLIC_URL|DATABASE_URL|AUTH_MODE|FIREBASE_PROJECT_ID|MOTIS_URL|TRANSIT_USER_AGENT|CORS_ORIGIN|LOG_LEVEL|FIREBASE_SERVICE_ACCOUNT_FILE|EXPO_ACCESS_TOKEN|ADMIN_UIDS|ADMIN_TOTP_SECRET|ADMIN_ALLOW_IPS|RESEND_API_KEY|MAIL_FROM|MAIL_REPLY_TO|CONTACT_EMAIL|RESEND_WEBHOOK_SECRET|RESEND_INBOUND_API_KEY|OFFLINE_DIR|ALERT_EMAIL|PORT|HOST|NODE_ENV)=' || true)"
    [[ -n "$extra" ]] && printf '\n# Weitere Einstellungen\n%s\n' "$extra" >> "$tmp"
  fi
  chown root:"$CATCH_GROUP" "$tmp"
  chmod 0640 "$tmp"
  mv -f "$tmp" "$CATCH_ENV_FILE"
  ok "Einstellungen in $CATCH_ENV_FILE"
}

installed_port() { sed -n 's/^Environment=PORT=//p' "$CATCH_UNIT" 2>/dev/null | head -1; }

write_unit() {
  local port="$1" node_bin
  node_bin="$(command -v node)"
  [[ -f "$CATCH_UNIT" ]] && cp -a "$CATCH_UNIT" "$CATCH_UNIT.bak"
  cat > "$CATCH_UNIT" <<UNIT
# Verwaltet von Catch deploy/debian (setup.sh / update.sh) – wird bei jedem Lauf neu geschrieben.
# Einstellungen: $CATCH_ENV_FILE
[Unit]
Description=Catch – Kontroll-Meldungen ÖPNV ($CATCH_NAME)
Wants=network-online.target
After=network-online.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$CATCH_USER
Group=$CATCH_GROUP
WorkingDirectory=$CATCH_APP_DIR/server
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$port
EnvironmentFile=$CATCH_ENV_FILE
ExecStart=$node_bin dist/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true
SystemCallArchitectures=native
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=$CATCH_DATA_DIR
UMask=0027

[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 "$CATCH_UNIT"
}

# ---------------------------------------------------------------------------
# Nginx
# ---------------------------------------------------------------------------
# Eigene Sites nur für unsere Domains. Certbot ergänzt später die TLS-Zeilen.
write_nginx_site() { # write_nginx_site DATEI "NAMEN" SNIPPET BESCHREIBUNG
  local file="$1" names="$2" snippet="$3" what="$4"
  cat > "$file" <<NGINX
# Catch ($CATCH_NAME) – $what. Eigene Site, unabhängig von anderen Seiten auf diesem Server.
server {
    listen 80;
    listen [::]:80;
    server_name $names;
    include $snippet;
}
NGINX
}

# Site-Datei anlegen oder – wenn Certbot sie schon verwaltet – nur die Namen anpassen.
ensure_nginx_site() { # ensure_nginx_site DATEI LINK "NAMEN" SNIPPET BESCHREIBUNG
  local file="$1" link="$2" names="$3" snippet="$4" what="$5"
  if [[ -f "$file" ]] && grep -q 'managed by Certbot' "$file"; then
    sed -i -E "s/(server_name[[:space:]]+)[^;]+;/\1$names;/" "$file"
  else
    write_nginx_site "$file" "$names" "$snippet" "$what"
  fi
  ln -sfn "$file" "$link"
}

# Regeln (bei jedem Lauf neu geschrieben, berühren keine TLS-Zeilen).
write_nginx_snippets() { # write_nginx_snippets PORT [APP-DOMAIN]
  local port="$1" app_domain="${2:-app.$CATCH_DEFAULT_DOMAIN}"
  install -d -m 0755 /etc/nginx/snippets
  install -d -o root -g www-data -m 0755 "$CATCH_FILES_ROOT" "$CATCH_SITE_ROOT" "$CATCH_STATIC_ROOT"

  # 1) Gemeinsam: API, WebSocket, Downloads – auf beiden Domains gleich erreichbar,
  #    damit ältere App-Versionen (API = Haupt-Domain) weiter funktionieren.
  cat > "$CATCH_NGINX_API_SNIPPET" <<'NGINX'
# Verwaltet von Catch deploy/debian – wird bei jedem Update neu geschrieben.
client_max_body_size 1m;
gzip on;
gzip_vary on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml;

# Live-Alarme: eine WebSocket-Verbindung pro offener App
location = /v1/ws {
    proxy_pass http://127.0.0.1:API_PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# API
location /v1/ {
    proxy_pass http://127.0.0.1:API_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
location = /health {
    proxy_pass http://127.0.0.1:API_PORT;
    proxy_set_header Host $host;
    access_log off;
}

# Downloads (Android-APK: liegt automatisch bereit, wenn catch-….apk in ~ liegt)
location /download/ {
    alias FILES_ROOT/;
    types { application/vnd.android.package-archive apk; }
    default_type application/octet-stream;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
}
NGINX

  # 2) Haupt-Domain: Website (statisches HTML)
  cat > "$CATCH_NGINX_SNIPPET" <<'NGINX'
# Verwaltet von Catch deploy/debian – Website (Haupt-Domain).
include API_SNIPPET;
root SITE_ROOT;
index index.html;
error_page 404 /404.html;

location /assets/ {
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=604800" always;
    add_header X-Content-Type-Options nosniff always;
}

# Admin-Bereich: nur eigene Skripte, nicht einbettbar, nicht indexiert, nie gecacht.
# Der eigentliche Schutz liegt im Server (Firebase-UID + 2FA-Code); die Seite selbst enthält nichts Geheimes.
location = /admin { return 301 /admin/; }
location /admin/ {
    try_files $uri /admin/index.html;
    add_header Cache-Control "no-store" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
}

# Karte (MapLibre + OpenFreeMap-Kacheln) – wird in der App (WebView) und in der Web-App (iframe)
# angezeigt, darf deshalb von der App-Domain eingebettet werden. Daten kommen von /v1/map.
location /map/ {
    try_files $uri /map/index.html;
    add_header Cache-Control "public, max-age=300" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self'; img-src 'self' data: blob: https://tiles.openfreemap.org; font-src 'self'; connect-src 'self' https://tiles.openfreemap.org; frame-ancestors 'self' https://APP_DOMAIN; base-uri 'none'; form-action 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Strict-Transport-Security "max-age=31536000" always;
}
location /map/vendor/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=604800" always;
    add_header X-Content-Type-Options nosniff always;
}

# Neues Passwort setzen (Link aus der Catch-Mail)
location = /reset-password {
    try_files /reset-password.html =404;
    add_header Cache-Control "no-store" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://identitytoolkit.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
}
location / {
    try_files $uri $uri.html $uri/ =404;
    add_header Cache-Control "public, max-age=600" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
}
NGINX

  # 3) app.-Subdomain: Web-App (Expo-Export, Single-Page-App)
  cat > "$CATCH_NGINX_APP_SNIPPET" <<'NGINX'
# Verwaltet von Catch deploy/debian – Web-App (app.-Subdomain).
include API_SNIPPET;

# Einstiegsseite immer neu prüfen, damit Updates sofort sichtbar sind
location = /index.html {
    root STATIC_ROOT;
    add_header Cache-Control "no-cache" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
}
# PWA: Service Worker und Manifest immer frisch prüfen (sonst bleiben Updates hängen)
location = /sw.js {
    root STATIC_ROOT;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
}
location = /manifest.webmanifest {
    root STATIC_ROOT;
    types { }
    default_type application/manifest+json;
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
}
# Gehashte Metro-Dateien (Schriften, Bilder): unveränderlich, echtes 404 statt index.html
location /assets/ {
    root STATIC_ROOT;
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options nosniff always;
}
# Gehashte Build-Dateien ändern sich nie: ein Jahr cachen
location /_expo/static/ {
    root STATIC_ROOT;
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options nosniff always;
}
location / {
    root STATIC_ROOT;
    index index.html;
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "public, max-age=3600" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
NGINX
  sed -i "s|API_PORT|$port|g; s|STATIC_ROOT|$CATCH_STATIC_ROOT|g; s|SITE_ROOT|$CATCH_SITE_ROOT|g; s|FILES_ROOT|$CATCH_FILES_ROOT|g; s|API_SNIPPET|$CATCH_NGINX_API_SNIPPET|g; s|APP_DOMAIN|$app_domain|g" \
    "$CATCH_NGINX_API_SNIPPET" "$CATCH_NGINX_SNIPPET" "$CATCH_NGINX_APP_SNIPPET"
}

# Alles für Nginx in einem Schritt: Snippets, beide Sites, Test, Neuladen.
configure_nginx() { # configure_nginx PORT "HAUPT-NAMEN" APP-DOMAIN
  local port="$1" main_names="$2" app_domain="$3"
  write_nginx_snippets "$port" "$app_domain"
  ensure_nginx_site "$CATCH_NGINX_SITE" "$CATCH_NGINX_LINK" "$main_names" "$CATCH_NGINX_SNIPPET" "Website, API und Downloads"
  ensure_nginx_site "$CATCH_NGINX_APP_SITE" "$CATCH_NGINX_APP_LINK" "$app_domain" "$CATCH_NGINX_APP_SNIPPET" "Web-App"
  nginx_test_or_disable
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  ok "Nginx: $main_names (Website) · $app_domain (Web-App)"
}

# nginx -t; bei Fehler die Catch-Site wieder deaktivieren, damit die anderen Seiten weiterlaufen.
nginx_test_or_disable() {
  if nginx -t >/dev/null 2>&1; then
    return 0
  fi
  nginx -t || true
  rm -f "$CATCH_NGINX_LINK" "$CATCH_NGINX_APP_LINK"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fail "Die Nginx-Konfiguration ist fehlerhaft. Die Catch-Site wurde wieder deaktiviert; alle anderen Seiten laufen unverändert weiter."
}

# Gehört die Domain schon einer ANDEREN Nginx-Site? Dann nicht anfassen.
domain_claimed_elsewhere() {
  local domain="$1" f
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [[ -e "$f" ]] || continue
    [[ "$(readlink -f "$f")" == "$(readlink -f "$CATCH_NGINX_SITE" 2>/dev/null)" ]] && continue
    [[ "$(readlink -f "$f")" == "$(readlink -f "$CATCH_NGINX_APP_SITE" 2>/dev/null)" ]] && continue
    if grep -qE "server_name[^;]*[[:space:]]${domain//./\\.}([[:space:];])" "$f" 2>/dev/null; then
      printf '%s' "$f"
      return 0
    fi
  done
  return 1
}

site_domain() { grep -m1 -oP 'server_name\s+\K[^;\s]+' "$CATCH_NGINX_SITE" 2>/dev/null || true; }
app_site_domain() { grep -m1 -oP 'server_name\s+\K[^;\s]+' "$CATCH_NGINX_APP_SITE" 2>/dev/null || true; }
site_names()  { grep -m1 -oP 'server_name\s+\K[^;]+' "$CATCH_NGINX_SITE" 2>/dev/null || true; }

# ---------------------------------------------------------------------------
# DNS & HTTPS-Zertifikate
# ---------------------------------------------------------------------------
detect_public_ip() {
  local family="$1" url ip
  for url in $2; do
    ip="$(curl "-$family" -fsS --max-time 8 "$url" 2>/dev/null | tr -d '[:space:]')" || continue
    if [[ "$family" == "4" && "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$family" == "6" && "$ip" =~ ^[0-9A-Fa-f:]+$ && "$ip" == *:* ]]; then
      printf '%s' "$ip"; return 0
    fi
  done
  return 1
}
dns_init() {
  [[ -n "${PUBLIC_IP_DONE:-}" ]] && return 0
  PUBLIC_IPV4="$(detect_public_ip 4 'https://api.ipify.org https://ifconfig.me https://checkip.amazonaws.com' || true)"
  PUBLIC_IPV6="$(detect_public_ip 6 'https://api6.ipify.org https://ifconfig.me' || true)"
  PUBLIC_IP_DONE=1
}
dns_records() { getent "ahosts$1" "$2" 2>/dev/null | awk '{print $1}' | sort -u; }
dns_points_here() { # dns_points_here NAME
  dns_init
  [[ -n "$PUBLIC_IPV4" && "$(dns_records v4 "$1")" == *"$PUBLIC_IPV4"* ]] && return 0
  [[ -n "$PUBLIC_IPV6" && "$(dns_records v6 "$1")" == *"$PUBLIC_IPV6"* ]] && return 0
  return 1
}

letsencrypt_default_email() {
  grep -h -oP '"contact":\s*\[\s*"mailto:\K[^"]+' /etc/letsencrypt/accounts/*/directory/*/regr.json 2>/dev/null | head -1 || true
}

# Zertifikat für alle NAMEN holen/erweitern, deren DNS schon hierher zeigt.
# Gibt 0 zurück, wenn ein Zertifikat aktiv ist.
obtain_certificate() { # obtain_certificate CERT-NAME NAME...
  local cert_name="$1"; shift
  local names=() n mail_args
  for n in "$@"; do
    if dns_points_here "$n"; then names+=(-d "$n"); else warn "DNS für $n zeigt (noch) nicht hierher – kein Zertifikat dafür."; fi
  done
  (( ${#names[@]} )) || return 1
  local email="${LETSENCRYPT_EMAIL:-$(letsencrypt_default_email)}"
  if [[ -n "$email" ]]; then mail_args=(--email "$email"); else mail_args=(--register-unsafely-without-email); fi
  info "HTTPS-Zertifikat: ${names[*]//-d /}"
  certbot --nginx --non-interactive --agree-tos "${mail_args[@]}" --redirect --keep-until-expiring \
    --expand --cert-name "$cert_name" "${names[@]}"
  nginx_test_or_disable
  systemctl reload nginx
  return 0
}

# Antwortet https://NAME/PFAD von diesem Server aus?
https_ok() { curl -fsS --max-time 15 --resolve "$1:443:127.0.0.1" "https://$1${2:-/health}" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Android-App: neueste APK (oder Artefakt-ZIP) aus ~ übernehmen
# ---------------------------------------------------------------------------
find_apk() {
  local f best="" pat
  for pat in "${CATCH_APK_PATTERNS[@]}"; do
    for f in "$CATCH_KEY_HOME"/$pat; do
      [[ -f "$f" && -s "$f" ]] || continue
      if [[ -z "$best" || "$f" -nt "$best" ]]; then best="$f"; fi
    done
  done
  [[ -n "$best" ]] && printf '%s' "$best"
  return 0
}

install_apk_from_home() {
  local src tmp target="$CATCH_FILES_ROOT/catch.apk"
  src="$(find_apk)"
  [[ -n "$src" ]] || return 0
  tmp="$(mktemp)"
  if [[ "$src" == *.zip ]]; then
    command -v unzip >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y unzip >/dev/null
    unzip -p "$src" '*.apk' > "$tmp" 2>/dev/null || true
  else
    cp "$src" "$tmp"
  fi
  # Eine APK ist ein ZIP-Archiv mit AndroidManifest.xml.
  # Wichtig: nicht "unzip -l | grep -q" – grep beendet sich beim ersten Treffer, unzip bekommt
  # bei großen APKs (tausende Einträge) SIGPIPE und mit pipefail gilt die Prüfung als fehlgeschlagen.
  local listing
  listing="$(unzip -l "$tmp" 2>/dev/null || true)"
  if [[ "$listing" != *AndroidManifest.xml* ]]; then
    rm -f "$tmp"; warn "$src enthält keine gültige APK – übersprungen."; return 0
  fi
  if [[ -f "$target" ]] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"
    [[ -f "$CATCH_APK_MARKER.pending" && "$(basename "$src")" == catch-android-build*.zip ]] && mv -f "$CATCH_APK_MARKER.pending" "$CATCH_APK_MARKER"
    ok "Android-App aktuell ($(basename "$src"))"; return 0
  fi
  install -d -o root -g www-data -m 0755 "$CATCH_FILES_ROOT"
  install -o root -g www-data -m 0644 "$tmp" "$target"
  rm -f "$tmp"
  # Stammt die Datei vom automatischen GitHub-Download, den Build als bereitgestellt merken
  if [[ -f "$CATCH_APK_MARKER.pending" && "$(basename "$src")" == catch-android-build*.zip ]]; then
    mv -f "$CATCH_APK_MARKER.pending" "$CATCH_APK_MARKER"
  fi
  ok "Android-App bereitgestellt: $(basename "$src") → /download/catch.apk"
}

# ---------------------------------------------------------------------------
# Firebase-Service-Account (Push) – wird automatisch gefunden und installiert
# ---------------------------------------------------------------------------
# Ist DATEI ein Service-Account-Schlüssel des Projekts your-firebase-project?
valid_firebase_key() {
  local f="$1"
  [[ -f "$f" && -s "$f" ]] || return 1
  grep -q '"type": *"service_account"' "$f" && grep -q '"private_key"' "$f" &&
    grep -q "\"project_id\": *\"$CATCH_FIREBASE_PROJECT\"" "$f"
}

# Gibt den Pfad der neuesten passenden Schlüsseldatei aus (FIREBASE_KEY=… hat Vorrang).
# Gesucht wird in ~, allen Home-Ordnern, /root und im Catch-Quellordner.
find_firebase_key() {
  local source_dir="${1:-}" f best=""
  if [[ -n "${FIREBASE_KEY:-}" ]]; then
    printf '%s' "$FIREBASE_KEY"
    return 0
  fi
  for f in "$CATCH_KEY_HOME"/$CATCH_KEY_PATTERN /home/*/$CATCH_KEY_PATTERN /root/$CATCH_KEY_PATTERN \
           ${source_dir:+"$source_dir"/$CATCH_KEY_PATTERN}; do
    valid_firebase_key "$f" || continue
    if [[ -z "$best" || "$f" -nt "$best" ]]; then best="$f"; fi
  done
  [[ -n "$best" ]] && printf '%s' "$best"
  return 0
}

# Installiert den gefundenen Schlüssel nach /etc/catch-junify (nur lesbar für root + Dienst).
# Gibt 0 zurück, wenn ein Schlüssel aktiv ist.
install_firebase_key() {
  local source_dir="${1:-}" key
  key="$(find_firebase_key "$source_dir")"
  if [[ -z "$key" ]]; then
    if [[ -s "$CATCH_FIREBASE_KEY" ]]; then
      ok "Firebase-Schlüssel für Push aktiv ($CATCH_FIREBASE_KEY)"
      return 0
    fi
    warn "Kein Firebase-Schlüssel gefunden – Push-Alarme bei geschlossener App sind noch aus."
    warn "Datei $CATCH_KEY_PATTERN nach $CATCH_KEY_HOME/ legen und setup.sh/update.sh erneut starten."
    return 1
  fi
  valid_firebase_key "$key" || fail "$key ist kein Firebase-Service-Account des Projekts $CATCH_FIREBASE_PROJECT."
  if [[ -s "$CATCH_FIREBASE_KEY" ]] && cmp -s "$key" "$CATCH_FIREBASE_KEY"; then
    ok "Firebase-Schlüssel für Push aktiv ($(basename "$key"))"
    return 0
  fi
  install -d -o root -g "$CATCH_GROUP" -m 0750 "$CATCH_ETC"
  install -o root -g "$CATCH_GROUP" -m 0640 "$key" "$CATCH_FIREBASE_KEY.tmp"
  mv -f "$CATCH_FIREBASE_KEY.tmp" "$CATCH_FIREBASE_KEY"
  ok "Firebase-Schlüssel installiert: $(basename "$key") → $CATCH_FIREBASE_KEY"
  return 0
}

# Nächster freier Port ab START (eigener Dienst zählt als frei).
pick_free_port() {
  local p="$1"
  while (( p < $1 + 100 )); do
    port_in_use_by_other "$p" || { printf '%s' "$p"; return 0; }
    p=$(( p + 1 ))
  done
  return 1
}

# ---------------------------------------------------------------------------
# Hilfsbefehle & Sicherungen
# ---------------------------------------------------------------------------
write_helpers() {
  cat > /usr/local/bin/catch-admin <<WRAPPER
#!/usr/bin/env bash
# Catch – Werkzeug für den Betrieb (junify.live).
set -Eeuo pipefail
[[ "\$(id -u)" -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
sql() { (cd / && runuser -u $CATCH_USER -- psql -X -d $CATCH_DB "\$@"); }
public_url() { grep -m1 '^CATCH_PUBLIC_URL=' "$CATCH_ENV_FILE" | cut -d= -f2-; }
case "\${1:-}" in
  apk)
    [[ -f "\${2:-}" ]] || { echo "Verwendung: catch-admin apk /pfad/zur/app-release.apk" >&2; exit 2; }
    install -D -o root -g www-data -m 0644 "\$2" "$CATCH_FILES_ROOT/catch.apk"
    echo "Android-App bereitgestellt: \$(public_url)/download/catch.apk"
    ;;
  firebase-key)
    [[ -f "\${2:-}" ]] || { echo "Verwendung: catch-admin firebase-key /pfad/zur/service-account.json" >&2; exit 2; }
    grep -q '"private_key"' "\$2" || { echo "Das ist keine Firebase-Service-Account-Datei." >&2; exit 2; }
    install -D -o root -g $CATCH_GROUP -m 0640 "\$2" "$CATCH_FIREBASE_KEY"
    grep -q '^FIREBASE_SERVICE_ACCOUNT_FILE=' "$CATCH_ENV_FILE" || printf 'FIREBASE_SERVICE_ACCOUNT_FILE=%s\n' "$CATCH_FIREBASE_KEY" >> "$CATCH_ENV_FILE"
    systemctl restart $CATCH_SERVICE
    echo "Firebase-Schlüssel installiert – Push an die Android-App ist aktiv."
    ;;
  stats)
    sql -c "SELECT (SELECT count(*) FROM users) AS nutzer,
                   (SELECT count(*) FROM reports) AS meldungen,
                   (SELECT count(*) FROM reports WHERE reported_at > now() - interval '24 hours') AS meldungen_24h,
                   (SELECT count(*) FROM reports WHERE flags > 0 AND NOT hidden) AS markiert,
                   (SELECT count(*) FROM reports WHERE hidden) AS ausgeblendet,
                   (SELECT count(*) FROM trackings WHERE ends_at > now()) AS aktive_trackings,
                   (SELECT count(*) FROM devices) AS geraete"
    ;;
  recent)
    [[ "\${2:-20}" =~ ^[0-9]+\$ ]] || { echo "Verwendung: catch-admin recent [Anzahl]" >&2; exit 2; }
    sql -c "SELECT r.id, r.kind AS art, l.name AS linie, r.prev_stop_name AS von, r.next_stop_name AS nach,
                   to_char(r.reported_at AT TIME ZONE 'Europe/Berlin', 'DD.MM. HH24:MI') AS zeit, r.flags AS markiert,
                   r.hidden AS aus, r.user_id
            FROM reports r JOIN lines l USING (line_key) ORDER BY r.reported_at DESC LIMIT \${2:-20}"
    ;;
  flags)
    # Von Nutzern gemeldete Inhalte ("Inhalt melden"), neueste Markierung zuerst
    sql -c "SELECT r.id, r.kind AS art, l.name AS linie, r.prev_stop_name AS von, r.next_stop_name AS nach,
                   r.flags AS markiert, r.hidden AS aus,
                   string_agg(f.reason || ' (' || left(f.user_id, 8) || ')', ', ' ORDER BY f.created_at) AS gruende,
                   to_char(max(f.created_at) AT TIME ZONE 'Europe/Berlin', 'DD.MM. HH24:MI') AS zuletzt, r.user_id AS von_nutzer
            FROM reports r JOIN lines l USING (line_key) JOIN report_flags f ON f.report_id = r.id
            GROUP BY r.id, l.name ORDER BY max(f.created_at) DESC LIMIT \${2:-30}"
    ;;
  ban|unban)
    [[ -n "\${2:-}" ]] || { echo "Verwendung: catch-admin \$1 <Firebase-UID>" >&2; exit 2; }
    v=true; [[ "\$1" == unban ]] && v=false
    printf "UPDATE users SET banned = %s WHERE id = :'uid';\n" "\$v" | sql -v uid="\$2"
    ;;
  hide)
    [[ "\${2:-}" =~ ^[0-9]+\$ ]] || { echo "Verwendung: catch-admin hide <Meldungs-ID>" >&2; exit 2; }
    sql -c "UPDATE reports SET hidden = true WHERE id = \$2"
    ;;
  unhide)
    # Wieder einblenden und Markierungen verwerfen (z. B. nach Prüfung: Meldung war korrekt)
    [[ "\${2:-}" =~ ^[0-9]+\$ ]] || { echo "Verwendung: catch-admin unhide <Meldungs-ID>" >&2; exit 2; }
    sql -c "DELETE FROM report_flags WHERE report_id = \$2" -c "UPDATE reports SET hidden = false, flags = 0 WHERE id = \$2"
    ;;
  delete)
    [[ "\${2:-}" =~ ^[0-9]+\$ ]] || { echo "Verwendung: catch-admin delete <Meldungs-ID>" >&2; exit 2; }
    sql -c "DELETE FROM reports WHERE id = \$2"
    ;;
  2fa)
    # Zweiter Faktor für https://…/admin/ – Geheimnis erzeugen (einmalig) und als QR-Code zeigen
    secret="\$(grep -m1 '^ADMIN_TOTP_SECRET=' "$CATCH_ENV_FILE" | cut -d= -f2- | tr -d '"')"
    if [[ -z "\$secret" || "\${2:-}" == "--reset" ]]; then
      secret="\$(python3 -c 'import base64,os;print(base64.b32encode(os.urandom(20)).decode())')"
      if grep -q '^ADMIN_TOTP_SECRET=' "$CATCH_ENV_FILE"; then
        sed -i "s|^ADMIN_TOTP_SECRET=.*|ADMIN_TOTP_SECRET=\$secret|" "$CATCH_ENV_FILE"
      else
        printf 'ADMIN_TOTP_SECRET=%s\n' "\$secret" >> "$CATCH_ENV_FILE"
      fi
      systemctl restart $CATCH_SERVICE
      echo "Neues 2FA-Geheimnis gespeichert – alte Codes/Einträge in der App gelten nicht mehr."
    fi
    uri="otpauth://totp/Catch%20Admin:\$(public_url | sed 's#https\?://##')?secret=\$secret&issuer=Catch%20Admin&algorithm=SHA1&digits=6&period=30"
    command -v qrencode >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qrencode >/dev/null 2>&1 || true
    echo
    echo "Mit einer Authenticator-App scannen (Google Authenticator, Aegis, 2FAS, 1Password …):"
    if command -v qrencode >/dev/null; then qrencode -t ANSIUTF8 -m 2 "\$uri"; else echo "(qrencode fehlt – Schlüssel von Hand eingeben)"; fi
    echo "Oder von Hand eingeben:  \$secret   (zeitbasiert, 6 Ziffern, 30 s)"
    echo "Admin-Bereich: \$(public_url)/admin/"
    echo "Erlaubte Firebase-UID(s): \$(grep -m1 '^ADMIN_UIDS=' "$CATCH_ENV_FILE" | cut -d= -f2-)"
    echo "Tipp: Danach 'clear' eingeben – das Geheimnis steht sonst im Terminal."
    ;;
  mail-test)
    [[ "\${2:-}" == *@* ]] || { echo "Verwendung: catch-admin mail-test du@example.com" >&2; exit 2; }
    key="\$(grep -m1 '^RESEND_API_KEY=' "$CATCH_ENV_FILE" | cut -d= -f2- | tr -d '"')"
    from="\$(grep -m1 '^MAIL_FROM=' "$CATCH_ENV_FILE" | cut -d= -f2- | sed 's/^"//; s/"\$//')"
    [[ -n "\$key" ]] || { echo "Kein RESEND_API_KEY in $CATCH_ENV_FILE." >&2; exit 1; }
    body="\$(python3 -c 'import json,sys;print(json.dumps({"from":sys.argv[1],"to":[sys.argv[2]],"subject":"Catch – Test-Mail","html":"<p>Der E-Mail-Versand von <b>Catch</b> funktioniert. ✓</p>","text":"Der E-Mail-Versand von Catch funktioniert."}))' "\$from" "\$2")"
    if out="\$(curl -sS -w '\n%{http_code}' -X POST https://api.resend.com/emails -H "Authorization: Bearer \$key" -H 'Content-Type: application/json' -d "\$body")" && [[ "\$(tail -1 <<<"\$out")" == 2* ]]; then
      echo "Gesendet an \$2 (Absender: \$from)."
    else
      echo "Fehlgeschlagen: \$(head -1 <<<"\$out")" >&2
      if grep -q 'not authorized to send' <<<"\$out"; then
        echo "Der API-Key darf nicht von dieser Domain senden (z. B. Key der anderen App auf dem Server, auf deren Domain beschränkt)." >&2
        echo "Lösung: resend.com → API Keys → neuer Key (Sending access, Domain: \$(sed 's/.*@//; s/>.*//' <<<"\$from")), dann: sudo catch-admin resend-key" >&2
      elif grep -qi 'domain is not verified\|verify' <<<"\$out"; then
        echo "Die Absender-Domain ist bei Resend nicht verifiziert (resend.com → Domains)." >&2
      elif grep -qi 'api key is invalid\|invalid_api_key' <<<"\$out"; then
        echo "Der API-Key ist ungültig. Neuen Key setzen: sudo catch-admin resend-key" >&2
      fi
      exit 1
    fi
    ;;
  resend-key)
    # Neuen Resend-Key setzen – Eingabe wird nicht angezeigt und landet nicht im Verlauf
    read -rsp "Resend-API-Key (re_…): " key; echo
    [[ "\$key" == re_* ]] || { echo "Das sieht nicht wie ein Resend-Key aus (beginnt mit re_)." >&2; exit 2; }
    if grep -q '^RESEND_API_KEY=' "$CATCH_ENV_FILE"; then
      sed -i "s|^RESEND_API_KEY=.*|RESEND_API_KEY=\$key|" "$CATCH_ENV_FILE"
    else
      printf 'RESEND_API_KEY=%s\n' "\$key" >> "$CATCH_ENV_FILE"
    fi
    unset key
    systemctl restart $CATCH_SERVICE
    echo "Gespeichert und Catch neu gestartet. Test: sudo catch-admin mail-test du@example.com"
    ;;
  apk-update)
    /usr/local/bin/catch-apk-update "\${2:-}"
    ;;
  resend-webhook|resend-inbound-key)
    if [[ "\$1" == resend-webhook ]]; then
      echo "Resend → Webhooks → Endpoint \$(public_url)/v1/mail/inbound (Ereignis: email.received) → Signing secret kopieren."
      read -rsp "Signing secret (whsec_…): " val; echo
      [[ "\$val" =~ ^whsec_[A-Za-z0-9+/=]{20,}\$ ]] || { echo "Das sieht nicht wie ein Webhook-Secret aus (beginnt mit whsec_)." >&2; exit 2; }
      k=RESEND_WEBHOOK_SECRET
    else
      echo "API-Key mit Full access (zum Lesen empfangener Mails)."
      read -rsp "Resend-API-Key (re_…): " val; echo
      [[ "\$val" == re_* ]] || { echo "Das sieht nicht wie ein Resend-Key aus." >&2; exit 2; }
      k=RESEND_INBOUND_API_KEY
    fi
    if grep -q "^\$k=" "$CATCH_ENV_FILE"; then sed -i "s|^\$k=.*|\$k=\$val|" "$CATCH_ENV_FILE"; else printf '%s=%s\n' "\$k" "\$val" >> "$CATCH_ENV_FILE"; fi
    unset val
    systemctl restart $CATCH_SERVICE
    echo "Gespeichert und Catch neu gestartet."
    ;;
  admin-uid)
    [[ "\${2:-}" =~ ^[A-Za-z0-9_-]{6,128}(,[A-Za-z0-9_-]{6,128})*\$ ]] || { echo "Verwendung: catch-admin admin-uid <Firebase-UID>[,<weitere UID>]   (aktuell: \$(grep -m1 '^ADMIN_UIDS=' "$CATCH_ENV_FILE" | cut -d= -f2-))" >&2; exit 2; }
    if grep -q '^ADMIN_UIDS=' "$CATCH_ENV_FILE"; then sed -i "s|^ADMIN_UIDS=.*|ADMIN_UIDS=\$2|" "$CATCH_ENV_FILE"; else printf 'ADMIN_UIDS=%s\n' "\$2" >> "$CATCH_ENV_FILE"; fi
    systemctl restart $CATCH_SERVICE
    echo "Gespeichert: Admin-Bereich für \$2 (Catch neu gestartet). Fehlt noch der 2FA-Code: sudo catch-admin 2fa"
    ;;
  contact-email)
    [[ "\${2:-}" == *@* ]] || { echo "Verwendung: catch-admin contact-email du@example.com   (Antwort-Adresse + Kontakt in Catch-Mails)" >&2; exit 2; }
    for k in MAIL_REPLY_TO CONTACT_EMAIL; do
      if grep -q "^\$k=" "$CATCH_ENV_FILE"; then sed -i "s|^\$k=.*|\$k=\$2|" "$CATCH_ENV_FILE"; else printf '%s=%s\n' "\$k" "\$2" >> "$CATCH_ENV_FILE"; fi
    done
    systemctl restart $CATCH_SERVICE
    echo "Gespeichert: Antworten auf Catch-Mails gehen an \$2 (Catch neu gestartet)."
    ;;
  alert-email)
    [[ "\${2:-}" == *@* ]] || { echo "Verwendung: catch-admin alert-email du@example.com   (aktuell: \$(grep -m1 '^ALERT_EMAIL=' "$CATCH_ENV_FILE" | cut -d= -f2-))" >&2; exit 2; }
    if grep -q '^ALERT_EMAIL=' "$CATCH_ENV_FILE"; then sed -i "s|^ALERT_EMAIL=.*|ALERT_EMAIL=\$2|" "$CATCH_ENV_FILE"; else printf 'ALERT_EMAIL=%s\n' "\$2" >> "$CATCH_ENV_FILE"; fi
    echo "Gespeichert: ALERT_EMAIL=\$2 – sende Test-Mail …"
    if /usr/local/bin/catch-alert "Test: Überwachung eingerichtet" "Ab jetzt bekommst du hier eine E-Mail, wenn bei Catch etwas nicht stimmt (API, HTTPS, Zertifikat, Speicherplatz, Sicherung, Offline-Fahrpläne) – und eine Entwarnung, sobald es wieder läuft."; then
      echo "Fertig. Kommt nichts an: Spam-Ordner prüfen."
    else
      echo "Die Adresse ist gespeichert, aber die Test-Mail ging nicht raus (Grund siehe oben)." >&2
    fi
    ;;
  monitor)
    /usr/local/bin/catch-monitor
    ls "$CATCH_DATA_DIR/monitor/"*.down 2>/dev/null | sed 's#.*/##; s#\.down##' | sed 's/^/  Problem: /' || true
    [[ -z "\$(ls "$CATCH_DATA_DIR/monitor/"*.down 2>/dev/null)" ]] && echo "  Alles in Ordnung."
    ;;
  github-token)
    echo "Fine-grained Token mit Zugriff nur auf $CATCH_GITHUB_REPO und dem Recht Actions → Read-only."
    read -rsp "GitHub-Token (github_pat_…): " tok; echo
    [[ "\$tok" =~ ^(github_pat_|ghp_)[A-Za-z0-9_]{20,}\$ ]] || { echo "Das sieht nicht wie ein GitHub-Token aus." >&2; exit 2; }
    code="\$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer \$tok" -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$CATCH_GITHUB_REPO/actions/workflows/$CATCH_GITHUB_WORKFLOW/runs?per_page=1")"
    if [[ "\$code" != 200 ]]; then echo "GitHub lehnt das Token ab (HTTP \$code) – Rechte prüfen: Repository $CATCH_GITHUB_REPO, Actions: Read-only." >&2; unset tok; exit 1; fi
    install -m 0600 -o root -g root /dev/null "$CATCH_GITHUB_TOKEN_FILE"
    printf '%s\n' "\$tok" > "$CATCH_GITHUB_TOKEN_FILE"
    unset tok
    echo "Gespeichert (nur für root lesbar). Neueste App jetzt holen: sudo catch-admin apk-update"
    ;;
  offline)
    case "\${2:-status}" in
      build)
        echo "Baue Offline-Fahrpläne (dauert ein paar Minuten) …"
        systemctl start $CATCH_OFFLINE_SERVICE.service || { journalctl -u $CATCH_OFFLINE_SERVICE -n 30 --no-pager; exit 1; }
        journalctl -u $CATCH_OFFLINE_SERVICE -n 20 --no-pager -o cat
        ;;
      status|*)
        if [[ -f "$CATCH_OFFLINE_DIR/index.json" ]]; then
          python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
print("Gebaut: %s" % d["builtAt"])
for r in d["regions"]: print("  %-14s %4.1f MB %7d Halte  gültig %s – %s  %s" % (r["id"], r["sizeBytes"]/1e6, r["stops"], r["validFrom"], r["validUntil"], r["name"]))' "$CATCH_OFFLINE_DIR/index.json"
        else
          echo "Noch keine Offline-Fahrpläne. Jetzt bauen: sudo catch-admin offline build"
        fi
        echo "Nächster automatischer Lauf: \$(systemctl list-timers $CATCH_OFFLINE_SERVICE.timer --no-pager 2>/dev/null | sed -n 2p | awk '{print \$1, \$2, \$3}')"
        ;;
    esac
    ;;
  psql) shift; sql "\$@" ;;
  *)
    cat <<HELP
catch-admin – Catch verwalten
  stats                     Nutzer, Meldungen, Trackings, Geräte zählen
  recent [N]                letzte N Meldungen anzeigen
  flags [N]                 von Nutzern gemeldete Inhalte (ab 3 Markierungen automatisch ausgeblendet)
  hide <ID> | unhide <ID>   Meldung ausblenden / wieder einblenden (setzt Markierungen zurück)
  delete <ID>               Meldung endgültig löschen
  ban <UID> | unban <UID>   Konto sperren / entsperren
  admin-uid <UID>[,<UID>]   wer in den Admin-Bereich darf (Firebase-UID aus Profil/Firebase-Konsole)
  2fa [--reset]             2FA für den Admin-Bereich einrichten / QR-Code erneut zeigen
  mail-test <adresse>       Test-Mail über Resend senden
  resend-key                Resend-API-Key setzen (verdeckte Eingabe)
  offline [build]           Offline-Fahrpläne für die App: Stand anzeigen / jetzt neu bauen
  apk-update [--check]      neueste Android-App von GitHub holen und bereitstellen
  alert-email <adresse>     E-Mail für Alarme der Überwachung setzen (schickt Test-Mail)
  contact-email <adresse>   Antwort-/Kontaktadresse für Catch-Mails (Moderation, Feedback-Antworten)
  resend-webhook            Webhook-Secret für den Mail-Empfang setzen (Posteingang im Admin-Bereich)
  resend-inbound-key        Resend-Key mit Full access zum Lesen empfangener Mails setzen
  monitor                   Überwachung jetzt ausführen und Stand zeigen
  github-token              GitHub-Token für den automatischen APK-Download setzen
  apk <datei.apk>           Android-App zum Download bereitstellen (/download/catch.apk)
  firebase-key <datei.json> Firebase-Service-Account für Push installieren
  psql                      Datenbank-Konsole
Admin-Bereich: \$(public_url)/admin/   ·   Sicherung: sudo catch-backup   ·   Logs: journalctl -u $CATCH_SERVICE -f
HELP
    ;;
esac
WRAPPER
  chmod 0750 /usr/local/bin/catch-admin

  cat > /usr/local/bin/catch-backup <<WRAPPER
#!/usr/bin/env bash
# Catch – Sicherung der Datenbank (läuft auch im Betrieb). Wiederherstellen:
#   sudo systemctl stop $CATCH_SERVICE
#   sudo -u postgres pg_restore --clean --if-exists -d $CATCH_DB <datei.dump>
#   sudo systemctl start $CATCH_SERVICE
set -Eeuo pipefail
[[ "\$(id -u)" -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
target="\${1:-$CATCH_BACKUP_DIR/catch-\$(date +%Y%m%d-%H%M%S).dump}"
install -d -m 0750 "\$(dirname "\$target")"
tmp="\$target.part"
(cd / && runuser -u postgres -- pg_dump -Fc "$CATCH_DB") > "\$tmp"
chmod 0600 "\$tmp"; mv -f "\$tmp" "\$target"
# Nur die 30 neuesten automatischen Sicherungen behalten.
find "$CATCH_BACKUP_DIR" -maxdepth 1 -name 'catch-*.dump' -type f -printf '%T@ %p\n' | sort -rn | tail -n +31 | cut -d' ' -f2- | xargs -r rm -f --
echo "Sicherung: \$target"
WRAPPER
  chmod 0750 /usr/local/bin/catch-backup

  # --- Android-App von GitHub holen ------------------------------------------------------
  {
    printf '#!/usr/bin/env bash\n# Verwaltet von Catch deploy/debian.\n'
    printf 'REPO=%q\nWORKFLOW=%q\nTOKEN_FILE=%q\nMARKER=%q\nFILES_ROOT=%q\nKEY_HOME=%q\nKEY_OWNER=%q\nAPI="${CATCH_GITHUB_API:-https://api.github.com}"\n' \
      "$CATCH_GITHUB_REPO" "$CATCH_GITHUB_WORKFLOW" "$CATCH_GITHUB_TOKEN_FILE" "$CATCH_APK_MARKER" "$CATCH_FILES_ROOT" "$CATCH_KEY_HOME" "$(stat -c %U:%G "$CATCH_KEY_HOME" 2>/dev/null || echo root:root)"
    cat <<'SCRIPT'

set -Eeuo pipefail
# Holt die neueste erfolgreich gebaute Android-App (GitHub Actions → Artefakt "catch-android")
# und stellt sie unter /download/catch.apk bereit.
#   catch-apk-update              herunterladen (falls neuer) und sofort bereitstellen
#   catch-apk-update --fetch-only nur herunterladen nach $KEY_HOME (update.sh stellt sie am Ende bereit)
#   catch-apk-update --check      nur prüfen, ob ein neuerer Build da ist
mode="${1:-install}"
[[ "$(id -u)" -eq 0 ]] || { echo "Bitte mit sudo ausführen." >&2; exit 1; }
say()  { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
if [[ ! -s "$TOKEN_FILE" ]]; then
  warn "Kein GitHub-Token – APK wird nicht automatisch geholt. Einrichten: sudo catch-admin github-token"
  exit 0
fi
token="$(tr -d ' \r\n' < "$TOKEN_FILE")"
api() { curl -fsS --max-time 30 -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$API/repos/$REPO/$1"; }
branch="${CATCH_APK_BRANCH:-}"
if [[ -z "$branch" && -d "${SOURCE_DIR:-}/.git" ]]; then
  branch="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [[ "$branch" == "HEAD" ]] && branch=""
fi
q="per_page=1&status=success"; [[ -n "$branch" ]] && q="$q&branch=$branch"
if ! runs="$(api "actions/workflows/$WORKFLOW/runs?$q")"; then
  warn "GitHub antwortet nicht oder das Token passt nicht (Rechte: Actions → Read-only für $REPO)."
  exit 0
fi
read -r run_id run_no run_sha run_date < <(python3 -c 'import json,sys
d=json.load(sys.stdin); r=(d.get("workflow_runs") or [None])[0]
print(*(("-","-","-","-") if not r else (r["id"], r["run_number"], r["head_sha"][:7], r["updated_at"])))' <<<"$runs")
if [[ "$run_id" == "-" ]]; then warn "Noch kein erfolgreicher App-Build${branch:+ auf $branch}."; exit 0; fi

# Läuft gerade ein neuerer Build?
if pending="$(api "actions/workflows/$WORKFLOW/runs?per_page=1${branch:+&branch=$branch}")"; then
  read -r p_no p_status < <(python3 -c 'import json,sys
d=json.load(sys.stdin); r=(d.get("workflow_runs") or [None])[0]
print(*((0,"-") if not r else (r["run_number"], r["status"])))' <<<"$pending")
  if [[ "$p_status" != "completed" && "$p_no" -gt "$run_no" ]]; then
    say "Hinweis: App-Build #$p_no läuft noch (ca. 25 Min.) – danach: sudo catch-admin apk-update"
  fi
fi

current="$(cat "$MARKER" 2>/dev/null || true)"
if [[ "$current" == "$run_id" && -f "$FILES_ROOT/catch.apk" ]]; then
  say "Android-App ist aktuell (Build #$run_no, $run_sha)."
  exit 0
fi
[[ "$mode" == "--check" ]] && { say "Neuer App-Build verfügbar: #$run_no ($run_sha, $run_date)"; exit 0; }

arts="$(api "actions/runs/$run_id/artifacts")" || { warn "Artefakte von Build #$run_no nicht lesbar."; exit 0; }
url="$(python3 -c 'import json,sys
d=json.load(sys.stdin)
a=[x for x in d.get("artifacts",[]) if x["name"]=="catch-android" and not x.get("expired")]
print(a[0]["archive_download_url"] if a else "")' <<<"$arts")"
[[ -n "$url" ]] || { warn "Build #$run_no hat kein (gültiges) Artefakt catch-android – evtl. abgelaufen."; exit 0; }

zip="$KEY_HOME/catch-android-build$run_no.zip"
say "Lade Android-App von GitHub (Build #$run_no, $run_sha) …"
# curl sendet den Authorization-Header bei der Weiterleitung zum Download-Server nicht mit
curl -fsSL --max-time 600 -H "Authorization: Bearer $token" -o "$zip.part" "$url" || { rm -f "$zip.part"; warn "Download fehlgeschlagen."; exit 0; }
tmp="$(mktemp)"
unzip -p "$zip.part" '*.apk' > "$tmp" 2>/dev/null || true
listing="$(unzip -l "$tmp" 2>/dev/null || true)"
if [[ "$listing" != *AndroidManifest.xml* ]]; then
  rm -f "$tmp" "$zip.part"; warn "Das Artefakt enthält keine gültige APK – behalte die alte."; exit 0
fi
mv -f "$zip.part" "$zip"
chown "$KEY_OWNER" "$zip" 2>/dev/null || true
# Ältere, automatisch geladene ZIPs aufräumen (die 2 neuesten bleiben)
ls -1t "$KEY_HOME"/catch-android-build*.zip 2>/dev/null | tail -n +3 | xargs -r rm -f --
if [[ "$mode" == "--fetch-only" ]]; then
  rm -f "$tmp"
  say "Android-App Build #$run_no bereit – wird am Ende des Updates veröffentlicht."
  printf '%s\n' "$run_id" > "$MARKER.pending"
  exit 0
fi
install -d -o root -g www-data -m 0755 "$FILES_ROOT"
install -o root -g www-data -m 0644 "$tmp" "$FILES_ROOT/catch.apk"
rm -f "$tmp"
printf '%s\n' "$run_id" > "$MARKER"
say "✓ Android-App Build #$run_no veröffentlicht: /download/catch.apk"
SCRIPT
  } > /usr/local/bin/catch-apk-update
  chmod 0750 /usr/local/bin/catch-apk-update

  # --- Überwachung (E-Mail-Alarm) --------------------------------------------------------
  {
    printf '#!/usr/bin/env bash\n# Verwaltet von Catch deploy/debian.\nENV_FILE=%q\n' "$CATCH_ENV_FILE"
    cat <<'SCRIPT'

set -Euo pipefail
# catch-alert "Betreff" "Text" – E-Mail an ALERT_EMAIL über Resend (sonst nur ins Journal)
subject="${1:-Catch}"; text="${2:-}"
setting() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed 's/^"//; s/"$//'; }
to="$(setting ALERT_EMAIL)"; key="$(setting RESEND_API_KEY)"; from="$(setting MAIL_FROM)"
logger -t catch-alert -- "$subject"
if [[ -z "$to" || -z "$key" ]]; then
  [[ -z "$to" ]] && echo "  ! Keine ALERT_EMAIL gesetzt – nur ins Journal geschrieben (sudo catch-admin alert-email …)." >&2
  [[ -n "$to" && -z "$key" ]] && echo "  ! Kein RESEND_API_KEY in $ENV_FILE – E-Mail nicht möglich (sudo catch-admin resend-key)." >&2
  exit 2
fi
host="$(hostname)"
body="$(python3 -c 'import json,sys,html
s,t,f,to,h=sys.argv[1:6]
pre=html.escape(t)
print(json.dumps({"from":f or "Catch <noreply@junify.live>","to":[to],"subject":"[Catch] "+s,
 "text":t+"\n\n— Catch-Überwachung auf "+h,
 "html":"<div style=\"font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#111a30;color:#fff;padding:24px\"><div style=\"max-width:640px;margin:0 auto;background:#22304f;border-radius:20px;padding:24px\"><p style=\"margin:0 0 8px;color:#c7e8a5;font-weight:800\">Catch · Überwachung</p><h1 style=\"margin:0 0 14px;font-size:22px\">"+html.escape(s)+"</h1><pre style=\"white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace;color:#c3cbe0;margin:0\">"+pre+"</pre><p style=\"margin:18px 0 0;color:#8c97b2;font-size:12px\">Server: "+html.escape(h)+"</p></div></div>"}))' "$subject" "$text" "$from" "$to" "$host")"
resp="$(curl -sS --max-time 20 -w '\n%{http_code}' -X POST "${CATCH_RESEND_URL:-https://api.resend.com}/emails" -H "Authorization: Bearer $key" -H 'Content-Type: application/json' -d "$body" 2>&1)" || true
code="${resp##*$'\n'}"; msg="${resp%$'\n'*}"
if [[ "$code" == 2* ]]; then
  echo "  ✓ E-Mail an $to gesendet."
  exit 0
fi
logger -t catch-alert -- "E-Mail an $to fehlgeschlagen (HTTP $code): $msg"
echo "  ✗ E-Mail an $to fehlgeschlagen (HTTP ${code:-?}): $msg" >&2
if [[ "$msg" == *"not authorized to send"* ]]; then
  echo "    → Der Resend-Key darf nicht von der Absender-Domain senden. Neuen Key (Sending access, Domain $(sed 's/.*@//; s/>.*//' <<<"${from:-x@junify.live}")) anlegen: sudo catch-admin resend-key" >&2
elif [[ "$msg" == *"domain is not verified"* || "$msg" == *"verify"* ]]; then
  echo "    → Die Absender-Domain ist bei Resend nicht verifiziert (resend.com → Domains)." >&2
elif [[ "$code" == 401 || "$msg" == *"API key is invalid"* ]]; then
  echo "    → Der Resend-Key ist ungültig: sudo catch-admin resend-key" >&2
fi
exit 1
SCRIPT
  } > /usr/local/bin/catch-alert
  chmod 0750 /usr/local/bin/catch-alert
  {
    printf '#!/usr/bin/env bash\n# Verwaltet von Catch deploy/debian.\nENV_FILE=%q\nUNIT=%q\nSERVICE=%q\nBACKUP_DIR=%q\nSTATE_DIR=%q\n' \
      "$CATCH_ENV_FILE" "$CATCH_UNIT" "$CATCH_SERVICE" "$CATCH_BACKUP_DIR" "$CATCH_DATA_DIR/monitor"
    cat <<'SCRIPT'

set -Euo pipefail
# Catch – Überwachung (alle 5 Minuten per systemd-Timer). Schickt eine E-Mail an ALERT_EMAIL,
# wenn etwas nicht stimmt, und eine Entwarnung, sobald es wieder läuft.
STATE="$STATE_DIR"; mkdir -p "$STATE"
setting() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed 's/^"//; s/"$//'; }
port="$(sed -n 's/^Environment=PORT=//p' "$UNIT" 2>/dev/null | head -1)"; port="${port:-8095}"
domain="$(setting CATCH_PUBLIC_URL | sed 's#^https\?://##; s#/.*##')"
problems=()   # "schlüssel|Betreff|Text"

check() { # check KEY "Betreff" "Text" BEDINGUNG_OK(0/1)
  local key="$1" subject="$2" text="$3" good="$4" flag="$STATE/$1.down" count="$STATE/$1.count"
  if [[ "$good" == 1 ]]; then
    rm -f "$count"
    if [[ -f "$flag" ]]; then rm -f "$flag"; catch-alert "✓ Wieder in Ordnung: $subject" "Seit $(date '+%d.%m.%Y %H:%M') ist wieder alles in Ordnung: $subject"; fi
    return
  fi
  # Erst nach 2 Fehlschlägen hintereinander melden (kurze Aussetzer ignorieren)
  local n=$(( $(cat "$count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$count"
  (( n >= 2 )) || return
  if [[ ! -f "$flag" ]] || [[ $(( $(date +%s) - $(stat -c %Y "$flag") )) -gt 21600 ]]; then
    touch "$flag"; catch-alert "⚠ $subject" "$text"
  fi
}

# 1) API lokal
ok=0; health="$(curl -fsS --max-time 8 "http://127.0.0.1:$port/health" 2>/dev/null)" && [[ "$health" == *'"ok":true'* ]] && ok=1
check api "Catch-API antwortet nicht" "Die API auf Port $port antwortet nicht oder meldet einen Fehler.
Antwort: ${health:-keine}

Letzte Log-Zeilen:
$(journalctl -u "$SERVICE" -n 25 --no-pager 2>/dev/null)

Prüfen: sudo systemctl status $SERVICE   ·   Neustart: sudo systemctl restart $SERVICE" "$ok"

# 2) Website von außen (Nginx + Zertifikat)
if [[ -n "$domain" ]]; then
  ok=0; code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$domain/health" 2>/dev/null)" && [[ "$code" == 200 ]] && ok=1
  check https "https://$domain ist nicht erreichbar" "https://$domain/health antwortet mit: ${code:-keine Antwort}.
Prüfen: sudo nginx -t && sudo systemctl status nginx" "$ok"

  # 3) Zertifikat läuft bald ab (< 14 Tage)
  cert="/etc/letsencrypt/live/$domain/fullchain.pem"
  if [[ -f "$cert" ]]; then
    end="$(date -d "$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)" +%s 2>/dev/null || echo 0)"
    days=$(( (end - $(date +%s)) / 86400 ))
    ok=1; (( days < 14 )) && ok=0
    check cert "HTTPS-Zertifikat für $domain läuft in $days Tagen ab" "Das Let's-Encrypt-Zertifikat läuft in $days Tagen ab – die automatische Verlängerung klappt offenbar nicht.
Prüfen: sudo certbot renew --dry-run" "$ok"
  fi
fi

# 4) Speicherplatz (< 10 % oder < 2 GB frei)
read -r avail pct < <(df -Pk / | awk 'NR==2 {print $4, 100-$5}')
ok=1; (( avail < 2*1024*1024 || pct < 10 )) && ok=0
check disk "Wenig Speicherplatz auf dem Server" "Frei: $((avail/1024/1024)) GB ($pct %).
Größte Ordner: $(du -xsh /var/lib/* /var/log /home 2>/dev/null | sort -rh | head -5 | tr '\n' ' ')" "$ok"

# 5) Datenbank-Sicherung älter als 36 h
newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'catch-*.dump' -printf '%T@\n' 2>/dev/null | sort -rn | head -1)"
ok=1; [[ -z "$newest" || $(( $(date +%s) - ${newest%.*} )) -gt 129600 ]] && ok=0
check backup "Keine aktuelle Datenbank-Sicherung" "Die neueste Sicherung in $BACKUP_DIR ist älter als 36 Stunden (oder fehlt).
Prüfen: sudo systemctl status ${SERVICE}-backup.service   ·   jetzt sichern: sudo catch-backup" "$ok"

# 6) Offline-Fahrpläne älter als 9 Tage
odir="$(setting OFFLINE_DIR)"
if [[ -n "$odir" ]]; then
  ok=1; [[ ! -f "$odir/index.json" || $(( $(date +%s) - $(stat -c %Y "$odir/index.json") )) -gt 777600 ]] && ok=0
  check offline "Offline-Fahrpläne sind veraltet" "Die Offline-Fahrpläne wurden seit über 9 Tagen nicht neu gebaut (oder noch nie).
Prüfen: sudo catch-admin offline   ·   Log: journalctl -u ${SERVICE}-offline -n 50" "$ok"
fi
exit 0
SCRIPT
  } > /usr/local/bin/catch-monitor
  chmod 0750 /usr/local/bin/catch-monitor
  cat > "/etc/systemd/system/$CATCH_NAME-monitor.service" <<UNIT
[Unit]
Description=Catch – Überwachung (API, HTTPS, Zertifikat, Speicher, Sicherung, Offline-Fahrpläne)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/catch-monitor
UNIT
  cat > "/etc/systemd/system/$CATCH_NAME-monitor.timer" <<UNIT
[Unit]
Description=Catch – Überwachung alle 5 Minuten
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
  # Schlägt ein Hintergrund-Dienst fehl (Sicherung, Offline-Bau), sofort Bescheid geben
  cat > "/etc/systemd/system/$CATCH_NAME-alert@.service" <<UNIT
[Unit]
Description=Catch – Alarm: %i fehlgeschlagen
[Service]
Type=oneshot
ExecStart=/bin/bash -c '/usr/local/bin/catch-alert "%i ist fehlgeschlagen" "\$\$(journalctl -u %i -n 40 --no-pager)"'
UNIT

  # --- Offline-Fahrpläne -----------------------------------------------------------------
  cat > /usr/local/bin/catch-offline-build <<WRAPPER
#!/usr/bin/env bash
# Catch – Offline-Fahrpläne bauen: GTFS-Feed laden (nur wenn neuer) und Pakete je Stadt erzeugen.
# Läuft als $CATCH_USER über den systemd-Dienst $CATCH_OFFLINE_SERVICE (wöchentlich per Timer).
set -Eeuo pipefail
feed_url="\${OFFLINE_FEED_URL:-https://download.gtfs.de/germany/free/latest.zip}"
zip="$CATCH_GTFS_DIR/de.zip"
install -d -m 0750 "$CATCH_GTFS_DIR" "$CATCH_OFFLINE_DIR"
z=(); [[ -s "\$zip" ]] && z=(-z "\$zip")
echo "Lade Fahrplandaten (\$feed_url) …"
if curl -fsSL --retry 3 --connect-timeout 20 -A "catch-junify (+$(grep -m1 '^CATCH_PUBLIC_URL=' "$CATCH_ENV_FILE" 2>/dev/null | cut -d= -f2-))" "\${z[@]}" -o "\$zip.part" "\$feed_url" && [[ -s "\$zip.part" ]]; then
  if unzip -tq "\$zip.part" >/dev/null 2>&1; then mv -f "\$zip.part" "\$zip"; echo "Neue Fahrplandaten geladen (\$(du -h "\$zip" | cut -f1))."; else echo "Download beschädigt – behalte die alten Daten." >&2; fi
else
  echo "Keine neueren Fahrplandaten (oder Download fehlgeschlagen) – nutze die vorhandenen."
fi
rm -f "\$zip.part"
[[ -s "\$zip" ]] || { echo "Keine Fahrplandaten vorhanden." >&2; exit 1; }
regions=(); [[ -f "$CATCH_ETC/offline-regions.json" ]] && regions=(--regions-file "$CATCH_ETC/offline-regions.json")
[[ -f "$CATCH_APP_DIR/server/dist/offline/build.js" ]] || { echo "Builder fehlt ($CATCH_APP_DIR/server/dist/offline/build.js) – bitte zuerst update.sh ausführen." >&2; exit 1; }
exec "$(command -v node)" --max-old-space-size=700 "$CATCH_APP_DIR/server/dist/offline/build.js" --zip "\$zip" --out "$CATCH_OFFLINE_DIR" --tmp "$CATCH_GTFS_DIR/tmp" "\${regions[@]}"
WRAPPER
  chmod 0755 /usr/local/bin/catch-offline-build
  install -d -o "$CATCH_USER" -g "$CATCH_GROUP" -m 0750 "$CATCH_GTFS_DIR" "$CATCH_OFFLINE_DIR"

  cat > "/etc/systemd/system/$CATCH_OFFLINE_SERVICE.service" <<UNIT
[Unit]
Description=Catch – Offline-Fahrpläne bauen (GTFS von gtfs.de)
Wants=network-online.target
After=network-online.target
OnFailure=$CATCH_NAME-alert@%n.service
[Service]
Type=oneshot
User=$CATCH_USER
Group=$CATCH_GROUP
WorkingDirectory=$CATCH_APP_DIR/server
ExecStart=/usr/local/bin/catch-offline-build
# Niedrige Priorität, damit Website und andere Seiten nichts merken
Nice=15
IOSchedulingClass=idle
CPUSchedulingPolicy=batch
MemoryMax=1500M
TimeoutStartSec=2h
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$CATCH_DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
UNIT
  cat > "/etc/systemd/system/$CATCH_OFFLINE_SERVICE.timer" <<UNIT
[Unit]
Description=Catch – Offline-Fahrpläne wöchentlich neu bauen
[Timer]
OnCalendar=Mon *-*-* 03:20:00
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
UNIT

  cat > "/etc/systemd/system/$CATCH_NAME-backup.service" <<UNIT
[Unit]
Description=Catch – tägliche Datenbanksicherung
After=postgresql.service
OnFailure=$CATCH_NAME-alert@%n.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/catch-backup
UNIT
  cat > "/etc/systemd/system/$CATCH_NAME-backup.timer" <<UNIT
[Unit]
Description=Catch – tägliche Datenbanksicherung
[Timer]
OnCalendar=*-*-* 03:45:00
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
}

wait_healthy() { # wait_healthy PORT
  local port="$1"
  for _ in $(seq 1 40); do
    curl --silent --fail --max-time 3 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && return 0
    if ! systemctl is-active --quiet "$CATCH_SERVICE" && [[ "$(systemctl show -p NRestarts --value "$CATCH_SERVICE" 2>/dev/null || echo 0)" -gt 3 ]]; then
      return 1
    fi
    sleep 1
  done
  return 1
}

port_in_use_by_other() { # true, wenn PORT von einem fremden Prozess belegt ist
  local port="$1" line pid
  line="$(ss -Hltnp "sport = :$port" 2>/dev/null || true)"
  [[ -z "$line" ]] && return 1
  pid="$(systemctl show -p MainPID --value "$CATCH_SERVICE" 2>/dev/null || echo 0)"
  [[ "$pid" != "0" && "$line" == *"pid=$pid,"* ]] && return 1
  return 0
}
