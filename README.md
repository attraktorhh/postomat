# Postomat

Social-Media-Posts für den [Attraktor](https://attraktor.org) ohne Social-Media-Kenntnisse.

Ein Mitglied schreibt einfach _„Ich will am Freitag einen Lötkurs machen“_ oder _„Ich habe eine Nixie-Uhr gebaut“_. Postomat erkennt, was daraus werden soll (Meetup-Event, Instagram-Post, Website-Eintrag …), fragt nach fehlenden Infos und Bildern und schickt den fertigen Entwurf zur Freigabe ans Medienteam in Matrix. Ein 👍 genügt.

➡️ **Planung und Konzept: [`docs/`](./docs/README.md)** · **Klickbarer Prototyp: [`docs/prototyp/index.html`](./docs/prototyp/index.html)**

## Entwicklung

Nx-Monorepo mit pnpm 12 und Node 24.

| Projekt                                       | Aufgabe                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/bot`                                    | Matrix-Bot (matrix-bot-sdk, E2EE mit Rust-Krypto): DM-Dialog, Karte in `#medienteam`, Reaktionen, Threads |
| `apps/web`                                    | Web-App und API (React Router 7 + HeroUI v3), Login per Keycloak                                          |
| `apps/worker`                                 | Jobs (pg-boss): Banner, WordPress, Wiki, Meetup-iCal                                                      |
| `apps/e2e`                                    | End-to-End-Tests und Smoke-Test gegen den Docker-Stack                                                    |
| `packages/core`                               | Zustandsautomat, Freigaberegeln, Checks, Dialog, Felder-Parser, Konfiguration                             |
| `packages/db`                                 | Drizzle-Schema und Migrationen                                                                            |
| `packages/workflow`                           | Anwendungslogik, die Bot, Web und Worker teilen (Einreichen, Freigeben, Veröffentlichen)                  |
| `packages/ai`, `templates`, `render`, `media` | KI (AI SDK), Texte DE + EN, Banner (Satori + resvg), Nextcloud (WebDAV)                                   |
| `packages/channels/*`                         | WordPress, MediaWiki, Meetup (iCal + Abgleich), Kopierhilfe                                               |
| `packages/testing`                            | Fakes für WordPress, MediaWiki, WebDAV, Meetup-iCal und Matrix                                            |

### Lokal starten

Alles läuft gegen einen lokalen Docker-Stack. **Kein Default zeigt auf echte Attraktor-Dienste.**
Details, Zugangsdaten und Neu-Seeden: [`dev/README.md`](./dev/README.md).

```sh
pnpm install
cp .env.example .env

# 1. Stack starten (Postgres, Synapse, Element, Keycloak, Fake-Meetup) und seeden
docker compose up -d --wait
#    mit WordPress, MediaWiki und Nextcloud:
docker compose --profile channels up -d --wait

# 2. Datenbank migrieren
pnpm nx run db:migrate

# 3. Apps starten (je ein Terminal)
pnpm nx run bot:serve      # Health: http://localhost:3001/healthz
pnpm nx run worker:serve   # Health: http://localhost:3002/healthz
pnpm nx run web:serve      # http://localhost:3000
```

Ohne `--profile channels` fallen WordPress und Wiki automatisch auf Kopierhilfe zurück, sobald ihre
Zugangsdaten in `.env` leer sind, und Fotos landen in `MEDIA_LOCAL_DIR` statt in Nextcloud.

### Ausprobieren

- **Element:** http://localhost:8080, anmelden als `lena` / `postomat-dev` (Mitglied) und eine DM mit
  `@postomat:localhost` starten. `kai` und `mira` (Passwort `postomat-dev`) sind im Medienteam und sehen
  die Karte in `#medienteam`. `gast` ist in keinem Raum und wird abgewiesen.
- **Web:** http://localhost:3000, gleiche Namen und Passwort `postomat-dev` über Keycloak.
  `lena` → Meine Beiträge, `kai`/`mira` → Redaktion, `admin` → `/admin/raeume`, `gast` → „Kein Zugang“.
- **Meetup-Event „anlegen“:** in den Fake-Feed schreiben, der Worker findet es beim nächsten Abgleich
  (`MEETUP_POLL_INTERVAL_MIN`):

  ```sh
  curl -X POST localhost:8084/_fake/events -H 'content-type: application/json' \
    -d '{"id":"312070001","title":"Lötkurs für Anfänger / Soldering for beginners","start":"2026-12-11T18:00","end":"2026-12-11T21:00"}'
  ```

- **E2EE-Hinweise:** Der Bot erscheint in Element als „nicht verifiziert“ (Geräte-Verifizierung und
  Cross-Signing sind in Stufe 1 nicht umgesetzt). Sein Krypto-Speicher liegt in `MATRIX_DATA_DIR`
  und darf nie verloren gehen. Ist er lokal doch weg: `dev/reset-matrix-device.sh @postomat:localhost POSTOMATDEV`.

### Tests

```sh
pnpm nx run-many -t lint test build typecheck   # alles, wie in CI
pnpm nx run e2e:test                            # Hauptablauf DM → Freigabe → Veröffentlichen → Meetup → online
pnpm nx run-many -t contract                    # Adapter-Verträge gegen Fakes; mit CONTRACT_TARGET=local gegen die Container
pnpm nx run e2e:stack-smoke                     # echter verschlüsselter DM gegen den laufenden Stack (Bot + Worker müssen laufen)
```

DB-Tests und E2E brauchen Postgres (`DATABASE_URL_TEST`, Standard: der Compose-Postgres). Die E2E-Suite legt
sich eine eigene Datenbank `<DATABASE_URL_TEST>_e2e` an, weil sie alle Tabellen leert. Die Adapter-Tests
laufen ohne Stack gegen In-Process-Fakes; mit `CONTRACT_TARGET=local` dieselbe Suite gegen die Container.
KI wird in Tests mit dem Mock-Modell des AI SDK simuliert.

### Auf echte Dienste umstellen

Umgestellt wird nur über Umgebungsvariablen (siehe `.env.example`):

| Dienst    | Variablen                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matrix    | `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN` (Synapse ist SSO-only), `MATRIX_DEVICE_ID`, `MATRIX_DATA_DIR` (Volume!), Räume über `/admin/raeume`  |
| Keycloak  | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `PUBLIC_WEB_URL`, Gruppen `GROUP_*`                                                          |
| WordPress | `WORDPRESS_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD`, `WORDPRESS_POST_STATUS=draft` für die ersten Tage                                  |
| Wiki      | `MEDIAWIKI_API_URL`, `MEDIAWIKI_PAGE_BASE_URL`, `MEDIAWIKI_BOT_USERNAME`, `MEDIAWIKI_BOT_PASSWORD`                                                  |
| Nextcloud | `NEXTCLOUD_WEBDAV_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`                                                                                  |
| Meetup    | `MEETUP_ICAL_URL=https://www.meetup.com/attraktor/events/ical/` (nur lesen), `MEETUP_GROUP_URL`                                                     |
| KI        | `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. Gesendet werden nur Beitragstext und Fakten, keine Matrix-IDs oder Namen. |

Kanal-Modi (`auto` / `copy` / `off`) je Postart stehen in [`postomat.config.json`](./postomat.config.json).
Fehlen Zugangsdaten für einen `auto`-Kanal, nutzt Postomat Kopierhilfe und warnt beim Start.

### Deployment (Coolify)

Je App ein Dockerfile, Build-Kontext ist das Repo-Root:

```sh
docker build -f apps/bot/Dockerfile -t postomat-bot .
docker build -f apps/web/Dockerfile -t postomat-web .
docker build -f apps/worker/Dockerfile -t postomat-worker .
```

Alle drei haben `/healthz` (bot 3001, web 3000, worker 3002). Der Worker führt beim Start die
Migrationen aus. Der Bot braucht ein dauerhaftes Volume auf `/data` (Krypto-Speicher).
Das Web-Image (`NODE_ENV=production`) startet nicht mit den Dev-Werten für `SESSION_SECRET` oder
`OIDC_CLIENT_SECRET`; für einen lokalen Test des Images echte Zufallswerte setzen.

### Bekannte Grenzen

- Wenn der Meetup-Link gefunden wird, schreibt Postomat den WordPress-Beitrag und die Wiki-Seite komplett
  neu (mit Link bzw. `meetupid`). Wer dort vorher von Hand etwas geändert hat, findet es nur noch in der
  Versionsgeschichte.
- Rollen (Gruppen aus Keycloak) gelten bis zur nächsten Anmeldung; eine Sitzung hält höchstens 12 Stunden.
  Wer aus `medienteam` oder `postomat-admin` entfernt wird, behält die Rechte bis dahin.
- Änderungen von außen (POST-Formulare) prüft die Web-App über `Origin`/`Sec-Fetch-Site`; Abmelden ist
  deshalb ein Button (POST), kein Link.

Neue Library anlegen:

```sh
pnpm nx g @nx/js:lib packages/<name>
```
