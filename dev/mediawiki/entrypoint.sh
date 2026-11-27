#!/bin/bash
# Idempotent MediaWiki bootstrap for local development (SQLite).
# LocalSettings.php lives in the data volume and is symlinked into the docroot.
set -euo pipefail

DATA=/var/www/data
LS="$DATA/LocalSettings.php"
MW=/var/www/html
as_www() { runuser -u www-data -- "$@"; }
maint() { as_www php "$MW/maintenance/run.php" "$@"; }

mkdir -p "$DATA"
chown -R www-data:www-data "$DATA"
mkdir -p "$MW/cache" "$MW/images" && chown -R www-data:www-data "$MW/cache" "$MW/images"

if [ ! -f "$LS" ]; then
  echo "[mediawiki-init] installing MediaWiki (SQLite)"
  rm -f "$MW/LocalSettings.php"
  maint install \
    --dbtype sqlite --dbpath "$DATA" --dbname mediawiki \
    --server "http://localhost:8082" --scriptpath "" \
    --lang en --pass "postomat-dev-admin" --confpath "$DATA" \
    "Attraktor Wiki (dev)" "Admin"
fi

if ! grep -q 'POSTOMAT-DEV' "$LS"; then
  cat >> "$LS" <<'PHP'

# --- POSTOMAT-DEV additions -------------------------------------------------
$wgServer = "http://localhost:8082";
$wgEnableUploads = false;
$wgEnableBotPasswords = true;
# Custom namespace like production: pages are named Termin:<Name>_<YYYY-MM-DD>
define( 'NS_TERMIN', 3000 );
define( 'NS_TERMIN_TALK', 3001 );
$wgExtraNamespaces[NS_TERMIN] = 'Termin';
$wgExtraNamespaces[NS_TERMIN_TALK] = 'Termin_Diskussion';
$wgNamespacesWithSubpages[NS_TERMIN] = true;
$wgContentNamespaces[] = NS_TERMIN;
# Bots may edit without captchas/rate limits in dev
$wgRateLimits = [];
PHP
fi
# The docroot is a sticky world-writable dir; with fs.protected_symlinks the
# symlink must be owned by www-data or Apache/PHP cannot follow it.
rm -f "$MW/LocalSettings.php"
as_www ln -s "$LS" "$MW/LocalSettings.php"

maint update --quick >/dev/null

# Bot user + bot password (lgname "Postomat@postomat").
# createAndPromote WITHOUT --force: re-setting the user password would invalidate
# all bot passwords. The bot password is recreated on every start (same value),
# which also repairs it if it was ever invalidated.
maint createAndPromote --bot Postomat "postomat-dev-user" 2>&1 | grep -v 'Account exists' || true
maint sql --query "DELETE FROM bot_passwords WHERE bp_app_id = 'postomat'" >/dev/null
maint createBotPassword --appid postomat \
  --grants basic,highvolume,editpage,createeditmovepage \
  Postomat postomatdevbotpassword0123456789

maint edit --user Admin --summary "Postomat dev seed" "Template:Termin" < /seed/Template_Termin.wikitext || true

chown -R www-data:www-data "$DATA"
echo "[mediawiki-init] done"
exec docker-php-entrypoint apache2-foreground
