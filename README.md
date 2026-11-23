# Postomat

Social-Media-Posts für den [Attraktor](https://attraktor.org) ohne Social-Media-Kenntnisse.

Ein Mitglied schreibt einfach _„Ich will am Freitag einen Lötkurs machen“_ oder _„Ich habe eine Nixie-Uhr gebaut“_. Postomat erkennt, was daraus werden soll (Meetup-Event, Instagram-Post, Website-Eintrag …), fragt nach fehlenden Infos und Bildern und schickt den fertigen Entwurf zur Freigabe ans Medienteam in Matrix. Ein 👍 genügt.

➡️ **Planung und Konzept: [`docs/`](./docs/README.md)**

## Entwicklung

Nx-Monorepo mit pnpm.

```sh
pnpm install
pnpm nx graph          # Projekte anzeigen
pnpm nx run-many -t build test lint typecheck
```

Neue Library anlegen:

```sh
pnpm nx g @nx/js:lib packages/<name>
```
