#!/usr/bin/env bash
# Smoke test for the local dev stack, run from the host: `bash dev/verify.sh [--channels]`.
# Leaves no test data behind (test post/media/page/files are deleted again).
set -uo pipefail

CHANNELS=0; [ "${1:-}" = "--channels" ] && CHANNELS=1
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAIL=0
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }
check() { local name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

echo "core"
check "postgres :55432 accepts connections" docker compose exec -T postgres psql -U postomat -d postomat_test -c 'select 1'
check "synapse /health" curl -fsS http://localhost:8008/health
check "element config.json" curl -fsS http://localhost:8080/config.json
ISS=$(curl -fsS http://localhost:8180/realms/attraktor/.well-known/openid-configuration | json 'd["issuer"]')
[ "$ISS" = "http://localhost:8180/realms/attraktor" ] && ok "keycloak issuer $ISS" || bad "keycloak issuer '$ISS'"
GROUPS_=$(curl -fsS -XPOST http://localhost:8180/realms/attraktor/protocol/openid-connect/token \
  -d grant_type=password -d client_id=postomat -d client_secret=postomat-dev-secret \
  -d username=kai -d password=postomat-dev -d scope=openid | json '
__import__("json").loads(__import__("base64").urlsafe_b64decode((lambda p: p + "=" * (-len(p) % 4))(d["id_token"].split(".")[1])))')
echo "$GROUPS_" | grep -q "'preferred_username': 'kai'" && echo "$GROUPS_" | grep -q "medienteam" \
  && ok "keycloak token for kai has preferred_username + groups" || bad "keycloak token claims: $GROUPS_"
for a in mitglieder medienteam; do
  RID=$(curl -fsS "http://localhost:8008/_matrix/client/v3/directory/room/%23$a%3Alocalhost" | json 'd["room_id"]')
  [ -n "$RID" ] && ok "room #$a:localhost = $RID" || bad "room #$a:localhost missing"
done
check "fake-meetup /healthz" curl -fsS http://localhost:8084/healthz
curl -fsS -D "$TMP/h" http://localhost:8084/attraktor/events/ical/ -o "$TMP/ics" && grep -qi 'content-type: text/calendar' "$TMP/h" \
  && grep -q 'BEGIN:VCALENDAR' "$TMP/ics" && ok "fake-meetup feed is text/calendar" || bad "fake-meetup feed"

[ $CHANNELS = 1 ] || { [ $FAIL = 0 ] && echo "all good" || echo "FAILURES"; exit $FAIL; }

echo "channels: wordpress"
WP=http://localhost:8081/wp-json/wp/v2; WA='postomat:dev0 dev0 dev0 dev0 dev0 dev0'
ME=$(curl -fsS -u "$WA" $WP/users/me | json 'd["slug"]'); [ "$ME" = postomat ] && ok "users/me = postomat" || bad "users/me '$ME'"
PID=$(curl -fsS -u "$WA" -XPOST $WP/posts -H 'content-type: application/json' -d '{"title":"verify","status":"draft"}' | json 'd["id"]')
[ -n "$PID" ] && ok "create post $PID" || bad "create post"
python3 -c "
import zlib,struct,sys
c=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
sys.stdout.buffer.write(b'\x89PNG\r\n\x1a\n'+c(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+c(b'IDAT',zlib.compress(b'\x00\xff\x00\x00'))+c(b'IEND',b''))" > "$TMP/t.png"
MID=$(curl -fsS -u "$WA" -XPOST $WP/media -H 'content-disposition: attachment; filename=verify.png' -H 'content-type: image/png' --data-binary @"$TMP/t.png" | json 'd["id"]')
[ -n "$MID" ] && ok "upload media $MID" || bad "upload media"
curl -fsS -u "$WA" -XDELETE "$WP/media/$MID?force=true" >/dev/null; curl -fsS -u "$WA" -XDELETE "$WP/posts/$PID?force=true" >/dev/null

echo "channels: mediawiki"
API=http://localhost:8082/api.php; J="$TMP/mw.jar"
LT=$(curl -fsS -c "$J" -b "$J" "$API?action=query&meta=tokens&type=login&format=json" | json 'd["query"]["tokens"]["logintoken"]')
R=$(curl -fsS -c "$J" -b "$J" -XPOST "$API" --data-urlencode action=login --data-urlencode lgname=Postomat@postomat \
  --data-urlencode lgpassword=postomatdevbotpassword0123456789 --data-urlencode "lgtoken=$LT" --data-urlencode format=json | json 'd["login"]["result"]')
[ "$R" = Success ] && ok "bot login Postomat@postomat" || bad "bot login: $R"
CT=$(curl -fsS -c "$J" -b "$J" "$API?action=query&meta=tokens&format=json" | json 'd["query"]["tokens"]["csrftoken"]')
TITLE="Termin:Verify $(date +%s)"
R=$(curl -fsS -c "$J" -b "$J" -XPOST "$API" --data-urlencode action=edit --data-urlencode "title=$TITLE" --data-urlencode createonly=1 \
  --data-urlencode 'text={{Termin|date=2026/01/01 07:30:00 PM|title=Verify}}' --data-urlencode "token=$CT" --data-urlencode format=json | json 'd["edit"]["result"]')
[ "$R" = Success ] && ok "edit $TITLE" || bad "edit: $R"
echo "$TITLE" | docker compose exec -T mediawiki runuser -u www-data -- php maintenance/run.php deleteBatch -u Admin >/dev/null 2>&1

echo "channels: nextcloud"
DAV=http://localhost:8083/remote.php/dav/files/postomat/Postomat-Fotos
for AUTH in "postomat:postomat-nextcloud-dev" "postomat:$(cat dev/.generated/nextcloud-app-password 2>/dev/null)"; do
  L="${AUTH:0:22}…"
  C=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" -XPROPFIND -H 'Depth: 1' "$DAV/"); [ "$C" = 207 ] && ok "PROPFIND ($L)" || bad "PROPFIND $C ($L)"
  C=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" -XMKCOL "$DAV/verify"); [ "$C" = 201 ] && ok "MKCOL ($L)" || bad "MKCOL $C"
  C=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" -T "$TMP/t.png" "$DAV/verify/t.png"); [ "$C" = 201 ] && ok "PUT ($L)" || bad "PUT $C"
  curl -fsS -u "$AUTH" "$DAV/verify/t.png" | cmp -s - "$TMP/t.png" && ok "GET ($L)" || bad "GET"
  curl -s -o /dev/null -u "$AUTH" -XDELETE "$DAV/verify"
done

[ $FAIL = 0 ] && echo "all good" || echo "FAILURES"
exit $FAIL
