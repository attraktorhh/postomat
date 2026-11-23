# Local development stack

Everything in `docker-compose.yml` runs **locally only**, with throwaway dev
credentials. Nothing here talks to a real Attraktor service.

## Start / stop

```sh
# core: Postgres, Synapse, Element Web, Keycloak, fake Meetup (+ matrix-seed)
docker compose up -d --wait

# core + channels: WordPress (+ MariaDB), MediaWiki, Nextcloud (+ wordpress-seed)
docker compose --profile channels up -d --wait

# smoke test from the host (cleans up after itself)
bash dev/verify.sh              # core
bash dev/verify.sh --channels   # core + channels

docker compose --profile channels stop        # stop, keep data
docker compose --profile channels down -v     # RESET: delete all containers + volumes
rm -f dev/.generated/nextcloud-app-password   # ...and the generated Nextcloud app password
```

`--wait` returns once every service is healthy **and** the seeds have finished
(the seed containers stay up idle and report healthy when done). A first start
takes about 1–2 minutes (Nextcloud install is the slowest part).

All seeds are idempotent: run them as often as you like.

| Re-run seed | Command                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| Matrix      | `docker compose restart matrix-seed && docker compose logs -f matrix-seed`                    |
| WordPress   | `docker compose --profile channels restart wordpress-seed`                                    |
| MediaWiki   | `docker compose --profile channels restart mediawiki` (seed runs in its entrypoint)           |
| Nextcloud   | `docker compose --profile channels restart nextcloud` (hook `before-starting`)                |
| Keycloak    | realm is imported on container (re)creation: `docker compose up -d --force-recreate keycloak` |
| Postgres    | `postomat_test` is created by `dev/postgres/01-create-test-db.sql` on an empty volume only    |

## Services, URLs, credentials

| Service        | URL (host)            | Notes                                                         |
| -------------- | --------------------- | ------------------------------------------------------------- |
| Postgres 17    | `localhost:55432`     | user `postomat` / `postomat`, DBs `postomat`, `postomat_test` |
| Synapse        | http://localhost:8008 | server_name `localhost`, SQLite                               |
| Element Web    | http://localhost:8080 | preconfigured for the local Synapse                           |
| Keycloak 26    | http://localhost:8180 | master console `admin` / `admin`                              |
| fake Meetup    | http://localhost:8084 | iCal feed + control API                                       |
| WordPress      | http://localhost:8081 | profile `channels`                                            |
| MediaWiki 1.43 | http://localhost:8082 | profile `channels`                                            |
| Nextcloud 31   | http://localhost:8083 | profile `channels`                                            |

Connection strings for the apps:

```
DATABASE_URL=postgres://postomat:postomat@localhost:55432/postomat
DATABASE_URL_TEST=postgres://postomat:postomat@localhost:55432/postomat_test
```

### Matrix (Synapse)

- Base URL `http://localhost:8008`, server name `localhost`.
- Users (created via the shared-secret admin API, secret `postomat-dev-registration-secret`):

  | User                  | Password           |                     |
  | --------------------- | ------------------ | ------------------- |
  | `@postomat:localhost` | `postomat-bot-dev` | the bot (not admin) |
  | `@lena:localhost`     | `postomat-dev`     |                     |
  | `@kai:localhost`      | `postomat-dev`     |                     |
  | `@mira:localhost`     | `postomat-dev`     |                     |
  | `@gast:localhost`     | `postomat-dev`     | in no room          |
  | `@admin:localhost`    | `postomat-dev`     | server admin        |

- Rooms (both end-to-end encrypted, `m.megolm.v1.aes-sha2`, private/invite-only):

  | Alias                   | Name                 | Joined                    | Created by |
  | ----------------------- | -------------------- | ------------------------- | ---------- |
  | `#mitglieder:localhost` | Attraktor Mitglieder | lena, kai, mira, postomat | lena       |
  | `#medienteam:localhost` | Medienteam           | kai, mira, postomat       | kai        |

  Room IDs change after a reset; resolve the alias or read them from
  `docker compose logs matrix-seed`.

- The seed logs every user in with the throwaway device `SEED` and logs out
  again. It never creates or touches the bot's real device `POSTOMATDEV`.
- E2EE is on by default for every new room
  (`encryption_enabled_by_default_for_room_type: all`). Rate limits are relaxed.
- Signing key and database live in the `synapse-data` volume (key generated on first start).

### Keycloak (OIDC)

- Issuer: `http://localhost:8180/realms/attraktor` (same for browser, host
  processes and containers, because `KC_HOSTNAME` is fixed).
- Client `postomat` (confidential), secret `postomat-dev-secret`; standard flow,
  PKCE (S256) accepted, direct access grants on (dev only); redirect and
  post-logout redirect `http://localhost:3000/*`, web origin `http://localhost:3000`.
- `groups` claim (group names, no path) in ID token, access token and userinfo.
  Users without groups (`gast`) get **no** `groups` claim at all, so treat a
  missing claim as `[]`.
- Realm users, password `postomat-dev` for all:

  | User  | Groups                     | `sub` (fixed)                          |
  | ----- | -------------------------- | -------------------------------------- |
  | lena  | mitglieder                 | `6b1c1a2e-0001-4c1a-9a00-00000000a001` |
  | kai   | mitglieder, medienteam     | `6b1c1a2e-0002-4c1a-9a00-00000000a002` |
  | mira  | mitglieder, medienteam     | `6b1c1a2e-0003-4c1a-9a00-00000000a003` |
  | gast  | –                          | `6b1c1a2e-0004-4c1a-9a00-00000000a004` |
  | admin | mitglieder, postomat-admin | `6b1c1a2e-0005-4c1a-9a00-00000000a005` |

  The realm `admin` user is separate from the master-console `admin`.

- The realm comes from `dev/keycloak/attraktor-realm.json`. Keycloak has no data
  volume: recreating the container re-imports the realm. User IDs are fixed in
  the JSON, so `sub` stays stable across resets.

Quick token check:

```sh
curl -s -X POST http://localhost:8180/realms/attraktor/protocol/openid-connect/token \
  -d grant_type=password -d client_id=postomat -d client_secret=postomat-dev-secret \
  -d username=kai -d password=postomat-dev -d scope=openid
```

### Fake Meetup iCal

Mimics `https://www.meetup.com/attraktor/events/ical/` (VCALENDAR with
Europe/Berlin VTIMEZONE, `UID:event_<id>@meetup.com`, `URL` pointing at
meetup.com, RFC 5545 escaping, 75-octet folding, CRLF). State lives in the
`fake-meetup-data` volume; the initial state is `dev/fake-meetup/events.json` (empty).

| Method | Path                      |                                     |
| ------ | ------------------------- | ----------------------------------- |
| GET    | `/attraktor/events/ical/` | the feed (`text/calendar`)          |
| GET    | `/_fake/events`           | list stored events (JSON)           |
| POST   | `/_fake/events`           | add or replace (same `id`) an event |
| DELETE | `/_fake/events`           | clear all events                    |
| GET    | `/healthz`                | health                              |

```sh
curl -X POST http://localhost:8084/_fake/events -H 'content-type: application/json' -d '{
  "id": "312070001", "title": "Lötkurs für Anfänger",
  "start": "2026-12-11T18:00", "end": "2026-12-11T21:00",
  "description": "Wir löten eine kleine Blinkschaltung."
}'
curl http://localhost:8084/attraktor/events/ical/
curl -X DELETE http://localhost:8084/_fake/events
```

`start`/`end` are local Europe/Berlin times. Optional field: `location`.

### WordPress (profile `channels`)

- Site URL `http://localhost:8081`, permalinks `/%postname%/`, `WP_ENVIRONMENT_TYPE=local`.
- Admin `admin` / `admin-dev`.
- REST base `http://localhost:8081/wp-json/wp/v2`.
- User `postomat` (editor, login password `postomat-wp-dev`) with application
  password **`dev0 dev0 dev0 dev0 dev0 dev0`** (spaces optional). Auth: HTTP Basic
  `postomat:dev0 dev0 dev0 dev0 dev0 dev0`.
- Categories: `Termine` (slug `termine`), `Workshops` (slug `workshops`).
  Look up IDs via `GET /wp-json/wp/v2/categories?slug=termine`.
- MariaDB: db/user/password `wordpress`, root `root-dev` (not exposed on the host).

### MediaWiki (profile `channels`)

- `http://localhost:8082`, API `http://localhost:8082/api.php`, SQLite.
- Admin `Admin` / `postomat-dev-admin`.
- Bot user `Postomat` (group `bot`, login password `postomat-dev-user`) with a
  BotPassword: `lgname=Postomat@postomat`, `lgpassword=postomatdevbotpassword0123456789`,
  grants `basic, highvolume, editpage, createeditmovepage`.
- Custom namespace `Termin` (ID 3000) like production, so pages are
  `Termin:<Name>_<YYYY-MM-DD>`.
- `Template:Termin` is imported from `dev/mediawiki/Template_Termin.wikitext`
  on every start (parameters `date`, `enddate`, `title`, `url`, `visible`, `meetupid`).
- `LocalSettings.php` and the SQLite DB live in the `mediawiki-data` volume.

### Nextcloud (profile `channels`)

- `http://localhost:8083`, admin `admin` / `admin-dev`, SQLite.
- User `postomat` / `postomat-nextcloud-dev`, folder `/Postomat-Fotos`.
- WebDAV base `http://localhost:8083/remote.php/dav/files/postomat/Postomat-Fotos/`.
  HTTP Basic works with **either** the plain password `postomat-nextcloud-dev`
  **or** the generated app password in `dev/.generated/nextcloud-app-password`
  (random, created once on first start, gitignored).

## Differences from production

- Synapse: password login and shared-secret registration are dev-only; no
  federation; SQLite; relaxed rate limits.
- Keycloak: `start-dev` (HTTP, H2, no volume); direct access grants enabled on
  the `postomat` client for testing.
- MediaWiki: no Semantic MediaWiki, no Page Forms, no widgets, no OIDC login;
  `Template:Termin` is a simplified infobox; `Calendar.ics` does not exist.
- WordPress: application passwords over plain HTTP only work because of
  `WP_ENVIRONMENT_TYPE=local`.
- Nextcloud: SQLite, HTTP, no 2FA.
- Meetup: just a static feed; the `URL`s point at meetup.com but nothing ever fetches them.

## Troubleshooting

- **Docker/OrbStack keeps crashing** – check free disk space on the host
  (`df -h ~`); the images need several GB (Nextcloud alone ~1.3 GB).
- **MediaWiki "LocalSettings.php not found or not readable"** – the docroot is a
  sticky world-writable directory, and with `fs.protected_symlinks` the symlink
  to the volume must be owned by `www-data`. The entrypoint handles this.
- **MediaWiki bot login "bot password must be reset"** – happens if the
  `Postomat` user password is changed (it invalidates all bot passwords).
  Restarting the `mediawiki` container recreates the bot password.
- **Nextcloud answers slowly / 401 after failed logins** – brute-force
  protection throttles after wrong passwords; wait, or reset it for the client IP shown in the
  Nextcloud log: `docker compose exec -u www-data nextcloud php occ security:bruteforce:reset <ip>`.
- **`up --wait` fails with "container exited"** – one of the seeds failed; see
  `docker compose logs matrix-seed` / `wordpress-seed`.
- **Keycloak realm changes not picked up** – the realm is only imported on a new
  container: `docker compose up -d --force-recreate keycloak`.
- **Element shows "Can't connect to homeserver"** – Synapse is still starting;
  `docker compose ps` should show it `healthy`.
