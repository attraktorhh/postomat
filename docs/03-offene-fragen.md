# Fragen und Entscheidungen

## Entschieden (23.11.2026)

| Frage                                    | Entscheidung                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Login für die Web-App                    | Keycloak (OIDC). Rollen aus Keycloak-Gruppen                                     |
| Wer darf einreichen?                     | Nur Mitglieder                                                                   |
| Freigabe                                 | 1 👍 aus `#medienteam`, nicht der eigene Beitrag                                 |
| Medienteam in Matrix                     | 2–3 Personen, Matrix ist Pflicht                                                 |
| Meetup                                   | Kein Pro. Kopierhilfe + Erkennung über den iCal-Feed                             |
| Sprache                                  | Deutsch und Englisch                                                             |
| Fotos                                    | Nextcloud als Ablage (noch leer), Einwilligung pro Bild in Postomat              |
| Regeltermine                             | Werden unterstützt: einmalige Serie anlegen + Monatsübersicht                    |
| Neue Kanäle                              | Mastodon-Konto anlegen                                                           |
| Kalender                                 | Meetup und Wiki bleiben die Kalender. Postomat schreibt ins Wiki und liest beide |
| KI                                       | Externer Anbieter ist bis zur lokalen Hardware in Ordnung                        |
| Bearbeiten/Löschen nach Veröffentlichung | Erst mal von Hand. Später als Funktion                                           |
| Styleguide                               | Aus den Instagram-Posts abgeleitet, siehe [05-styleguide.md](./05-styleguide.md) |

## Offen

### Zugänge (blockieren Stufe 1)

- **WordPress:** Wer legt einen technischen Benutzer mit Application Password an? (Letzte Beiträge kamen von andreas, Ludwig, nemo.)
- **Wiki:** Bot-Konto anlegen. Funktioniert die Schreib-API (`action=edit`) mit Login über OIDC, oder braucht es ein Bot-Passwort?
- **Matrix:** Bot-Konto `@postomat:attraktor.org` anlegen. Wie bekommt ein Bot-Konto bei SSO-only ein Login (Application Service, Admin-API oder Ausnahme)?
- **Keycloak:** Client für Postomat und Gruppen `mitglieder`, `medienteam`, `postomat-admin` (gibt es schon passende Gruppen?)
- **Nextcloud:** Ordner `/Postomat-Fotos` und ein technischer Benutzer mit App-Passwort

### Kanäle

- **Instagram:** `@attraktor_org` auf ein professionelles Konto umstellen (kostenlos). Wer hat die Zugangsdaten?
- **Facebook:** Ist die Seite mit Instagram verknüpft? Wer ist Admin?
- **Mastodon:** Auf welcher Instanz, wer legt das Konto an?
- **Website:** Postomat würde die Website wiederbeleben (letzter Beitrag im September). Sind die bisherigen Autor\*innen damit einverstanden?

### Gestaltung

- Logo als Datei (SVG oder großes PNG) und Titel-Schrift
- Wer gibt den abgeleiteten Styleguide offiziell frei?

### Organisation

- Wie viele Posts pro Monat wollen wir? (Bisher ca. 2–4 auf Instagram)
- Wer sind die ersten 3–5 Mitglieder für den Pilot? Am besten auch nicht-technische.
- DSGVO: Reicht die Einwilligungsfrage im Chat („alle waren einverstanden“), oder brauchen wir ein Formular?
