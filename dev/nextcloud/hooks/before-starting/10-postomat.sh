#!/bin/sh
# Idempotent Nextcloud seed (runs as www-data before Apache starts, on every start).
set -eu
cd /var/www/html

occ() { php /var/www/html/occ "$@"; }

if ! occ status --output=json 2>/dev/null | grep -q '"installed":true'; then
  echo "[postomat-seed] Nextcloud not installed yet, skipping"; exit 0
fi

occ config:system:set skeletondirectory --value='' >/dev/null
occ config:system:set templatedirectory --value='' >/dev/null
occ config:system:set overwrite.cli.url --value='http://localhost:8083' >/dev/null

if ! occ user:info postomat >/dev/null 2>&1; then
  OC_PASS=postomat-nextcloud-dev occ user:add --password-from-env --display-name=Postomat postomat
fi

DATADIR=$(occ config:system:get datadirectory)
if [ ! -d "$DATADIR/postomat/files/Postomat-Fotos" ]; then
  mkdir -p "$DATADIR/postomat/files/Postomat-Fotos"
  occ files:scan --path=/postomat/files >/dev/null
fi

OUT=/generated/nextcloud-app-password
if [ -d /generated ] && [ ! -s "$OUT" ]; then
  if occ list user 2>/dev/null | grep -q 'user:auth-tokens:add'; then cmd=user:auth-tokens:add; else cmd=user:add-app-password; fi
  NC_PASS=postomat-nextcloud-dev occ "$cmd" --password-from-env postomat | tail -n 1 | tr -d '[:space:]' > "$OUT.tmp"
  mv "$OUT.tmp" "$OUT"
  echo "[postomat-seed] app password written to dev/.generated/nextcloud-app-password"
fi
echo "[postomat-seed] done"
