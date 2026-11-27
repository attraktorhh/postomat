#!/usr/bin/env bash
# Dev only: delete a Matrix device on the local Synapse, e.g. after deleting a
# local crypto store (otherwise the server rejects the new keys with
# "One time key … already exists").
#   dev/reset-matrix-device.sh @postomat:localhost POSTOMATDEV
# Then also delete the matching local store (.data/matrix for the bot).
set -euo pipefail
USER_ID=${1:?user id, e.g. @postomat:localhost}
DEVICE=${2:?device id, e.g. POSTOMATDEV}
HS=${MATRIX_HOMESERVER_URL:-http://localhost:8008}
TOKEN=$(curl -fsS -X POST "$HS/_matrix/client/v3/login" \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"postomat-dev","device_id":"RESETSCRIPT"}' |
  sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" "$HS/_synapse/admin/v2/users/$USER_ID/devices/$DEVICE" >/dev/null && echo "deleted $DEVICE of $USER_ID"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$HS/_matrix/client/v3/logout" -d '{}' >/dev/null
