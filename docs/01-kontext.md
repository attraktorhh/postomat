# Kontext

Stand: 23.11.2026. Die Angaben zu den Kanälen stammen aus den öffentlichen Seiten und aus Screenshots des Instagram-Profils.

## Attraktor e.V.

Makerspace in Hamburg-Altona, Eschelsweg 4, 1. Stock, 22767 Hamburg. Die Mitglieder sind gemischt: einige sind sehr technisch, viele nicht. Die Social-Media-Präsenz betreut ein kleines Medienteam aus **2–3 Personen**. Aktuell hängt es an Einzelnen, ob ein Event oder Projekt nach außen sichtbar wird.

## Vorhandene Infrastruktur

| System               | Stand                                                    | Bedeutung für Postomat                                                                 |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Keycloak**         | Single Sign-on für alle Dienste                          | Login für die Web-App. Rollen kommen aus Keycloak-Gruppen                              |
| **Matrix** (Synapse) | Login nur per SSO, es gibt einen Raum nur für Mitglieder | Bot für Eingabe (DM) und Freigabe (`#medienteam`)                                      |
| **Nextcloud**        | vorhanden, bisher keine Fotos                            | Ablage der Fotobibliothek (WebDAV). Mitglieder können auch per Nextcloud-App hochladen |
| **Coolify**          | Self-Hosting (Docker)                                    | Deployment                                                                             |
| **KI**               | lokale Hardware kommt später                             | Bis dahin ist ein externer Anbieter in Ordnung                                         |

## Ausgabekanäle

| Kanal                                     | Was es gibt                                                                                                                                                                                        | Wie Postomat veröffentlicht                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Meetup** (`meetup.com/attraktor`)       | 1.459 Mitglieder. **Kein API-Zugang** (Meetup Pro kostet). Öffentlicher iCal-Feed `meetup.com/attraktor/events/ical/` funktioniert (nur kommende Events, ohne Ort-Feld, ohne Anmeldezahlen)        | **Kopierhilfe**: ein Kopier-Knopf pro Feld. Danach erkennt Postomat das neue Event im iCal-Feed |
| **Website** (`blog.attraktor.org`)        | `attraktor.org` leitet dorthin um. WordPress 7.1, REST-API mit Application Passwords. **Kein Event-Plugin**: Events sind normale Beiträge in der Kategorie „Termine“. Letzter Beitrag 15.09.2026   | Automatisch per REST: Beitrag mit Titelbild, „Wo / Wann / Was“-Block, Meetup-Link, DE + EN      |
| **Wiki** (`wiki.attraktor.org`)           | MediaWiki 1.43 mit Semantic MediaWiki und Page Forms. Jedes Event ist eine Seite `Termin:Name_JJJJ-MM-TT` mit Vorlage `{{Termin}}`. Daraus entstehen Startseite und `Calendar.ics`. Login per OIDC | Automatisch mit Bot-Konto: Termin-Seite anlegen. Schreibzugriff über die API ist noch zu testen |
| **Instagram** (`@attraktor_org`)          | 60 Beiträge, 345 Follower, ca. 2–4 Posts im Monat. Vermutlich noch **privates Konto** (keine Kategorie sichtbar)                                                                                   | Instagram-API (kostenlos), sobald auf professionelles Konto umgestellt. Bis dahin Kopierhilfe   |
| **Facebook** (`facebook.com/attraktoreV`) | Seite vorhanden                                                                                                                                                                                    | Kopierhilfe, später Graph-API zusammen mit Instagram                                            |
| **Mastodon**                              | Noch kein Konto. Soll angelegt werden (z. B. auf chaos.social)                                                                                                                                     | Automatisch, einfache API                                                                       |

## Regeltermine (Beispiele)

| Termin                          | Wann                          | Quelle                        |
| ------------------------------- | ----------------------------- | ----------------------------- |
| Handarbeitstreff                | donnerstags 16–19 Uhr         | Meetup                        |
| Basteldonnerstag – Meet'n'Greet | donnerstags ab 19:00 / 19:30  | Meetup sagt 19:00, Wiki 19:30 |
| Open Lockpicking Workshop       | mittwochs ab 19:30            | Wiki                          |
| Meshcore/Meshtastic-Stammtisch  | 2. Montag im Monat, 19–21 Uhr | Meetup                        |
| Konvent                         | alle 5 Wochen                 | Wiki                          |

Meetup und Wiki widersprechen sich teilweise. Postomat liest beide Kalender und kann solche Abweichungen melden.

## Stil

Siehe [05-styleguide.md](./05-styleguide.md).
