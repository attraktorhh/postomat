# Kontext

## Attraktor e.V.

Makerspace in Hamburg. Die Mitglieder sind gemischt: einige sind sehr technisch, viele nicht. Die Social-Media-Präsenz betreut ein kleines Medienteam. Aktuell hängt es an Einzelnen, ob ein Event oder Projekt nach außen sichtbar wird.

## Ausgabekanäle

| Kanal                   | Wofür                                      | Anmerkung                                                            |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| **Meetup**              | Events (Workshops, offene Abende, Treffen) | Braucht Datum, Uhrzeit, Ort und Beschreibung                         |
| **Instagram**           | Bilder, Projekte, Event-Teaser             | Braucht immer mindestens ein Bild; Business-/Creator-Account für API |
| **Facebook**            | Events und Posts                           | Läuft über die Meta Graph API, wie Instagram                         |
| **Website (WordPress)** | Blogposts, Event-Ankündigungen             | REST-API mit Application Password                                    |

## Interne Kommunikation

- **Matrix** (selbst gehostet) ist der Hauptmessenger und der offizielle Kommunikationskanal.
- Daraus folgt: Matrix ist der naheliegende Ort für die Eingabe (Bot im Raum oder Direktnachricht) **und** für die Freigabe (Medienteam-Raum, 👍-Reaktion).

## Infrastruktur

- **Coolify** zum Self-Hosting von Diensten (Docker-basiert).
- **Lokale LLMs/KI** sind möglicherweise bald verfügbar. Das System muss deshalb auch ohne lokale KI laufen oder mit austauschbarem Anbieter (z. B. Ollama oder ein OpenAI-kompatibler Endpunkt).
