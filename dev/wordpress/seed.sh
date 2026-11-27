#!/bin/sh
# Idempotent WordPress seed (runs in the wordpress:cli image as uid 33).
set -eu
cd /var/www/html

for i in $(seq 1 60); do
  [ -f wp-config.php ] && wp db check >/dev/null 2>&1 && break
  echo "waiting for wp-config.php / database ($i)"; sleep 2
done

if ! wp core is-installed 2>/dev/null; then
  wp core install --url=http://localhost:8081 --title="Attraktor (dev)" \
    --admin_user=admin --admin_password=admin-dev --admin_email=admin@attraktor.local --skip-email
fi

wp option update blogdescription "Lokale Entwicklungsinstanz" >/dev/null
wp option update timezone_string Europe/Berlin >/dev/null
wp rewrite structure '/%postname%/' >/dev/null
wp rewrite flush >/dev/null

ensure_category() { # name slug
  wp term get category "$2" --by=slug --field=term_id >/dev/null 2>&1 \
    || wp term create category "$1" --slug="$2" --porcelain >/dev/null
  echo "category $2: $(wp term get category "$2" --by=slug --field=term_id)"
}
ensure_category Termine termine
ensure_category Workshops workshops

if ! wp user get postomat --field=ID >/dev/null 2>&1; then
  wp user create postomat postomat@attraktor.local --role=editor \
    --user_pass=postomat-wp-dev --display_name=Postomat --porcelain >/dev/null
fi
wp user set-role postomat editor >/dev/null

wp eval-file /seed/app-password.php
echo "WordPress seed done."
