# Konzept (Entwurf)

## Ablauf aus Sicht eines Mitglieds

```
Mitglied (Matrix-DM oder Web)            Postomat                         Medienteam (Matrix-Raum)
─────────────────────────────            ────────                         ────────────────────────
"Ich will am 12.12. einen
 Lötkurs für Anfänger machen"  ───────▶  erkennt: Event + Workshop
                                          fragt nach, was fehlt:
                               ◀───────  "Uhrzeit? Wie viele Plätze?"
"18 Uhr, 8 Leute"              ───────▶
                               ◀───────  "Hast du Bilder?"
"nein"                         ───────▶  sucht in der Fotobibliothek
                               ◀───────  zeigt 3–4 passende Bilder
wählt Bild 2                   ───────▶  baut Entwurf:
                                          - Meetup-Event
                                          - Instagram-Post + Story
                                          - Website-Eintrag
                               ◀───────  "Schick ich so ans Medienteam?"
"ja"                           ───────▶  ───────────────────────────────▶ Vorschau aller Posts
                                                                          👍 = freigeben
                                                                          ✏️ / Antwort = Änderung
                                          veröffentlicht  ◀────────────── 👍
                               ◀───────  "Ist online: <Links>"
```

## Grundsätze

- **Ein Satz reicht.** Der Bot fragt nach, statt ein Formular zu zeigen. Pro Nachricht höchstens eine Frage.
- **Kein Post ohne Mensch.** Veröffentlicht wird nur nach Freigabe durch das Medienteam.
- **KI ist ein Helfer, keine Pflicht.** Ohne LLM gibt es einen einfachen Fallback (geführte Fragen mit Buttons).
- **Kanäle sind Plugins.** Meetup, Instagram, Facebook und WordPress sind jeweils ein eigener Adapter.

## Bausteine

| Baustein             | Aufgabe                                                                             | Erste Idee zur Umsetzung                                                                           |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Eingabe**          | Freitext und Bilder vom Mitglied annehmen                                           | Matrix-Bot (DM); später optional eine einfache Web-Seite                                           |
| **Klassifizierung**  | Postart erkennen, Felder extrahieren (Datum, Ort, Titel …), fehlende Infos erkennen | LLM mit strukturierter Ausgabe (JSON-Schema); Fallback: Fragenkatalog                              |
| **Dialog**           | Fehlende Infos nachfragen                                                           | Zustandsautomat pro Entwurf                                                                        |
| **Fotobibliothek**   | Alle Uploads speichern, verschlagworten, durchsuchen                                | Objektspeicher (S3/MinIO oder Dateisystem) + Embeddings (z. B. CLIP) für die Suche nach Bildinhalt |
| **Textgenerierung**  | Texte pro Kanal schreiben (Länge, Ton, Hashtags)                                    | LLM mit Vorlagen pro Kanal und Postart                                                             |
| **Freigabe**         | Entwurf im Medienteam-Raum zeigen, Reaktion auswerten                               | Matrix-Nachricht mit Vorschau; 👍 = freigeben, Antwort im Thread = ändern                          |
| **Veröffentlichung** | Posts an die Kanäle schicken                                                        | Ein Adapter pro Kanal                                                                              |
| **Admin-Oberfläche** | Entwürfe, Bibliothek und Vorlagen verwalten                                         | Kleine Web-App                                                                                     |

## Postarten (erster Wurf)

| Postart                       | Beispiel                                    | Meetup-Event? | Kanäle                               |
| ----------------------------- | ------------------------------------------- | ------------- | ------------------------------------ |
| **Event / Workshop**          | „Ich will einen Lötkurs hosten“             | Ja            | Meetup, Instagram, Facebook, Website |
| **Projekt-Showcase**          | „Ich habe eine Uhr aus Nixie-Röhren gebaut“ | Nein          | Instagram, Facebook, ggf. Website    |
| **Rückblick**                 | „Gestern war Repair Café, 20 Leute da“      | Nein          | Instagram, Facebook                  |
| **Ankündigung / Vereinsnews** | „Wir haben einen neuen Lasercutter“         | Nein          | alle                                 |
| **Regeltermin**               | „Jeden Dienstag offener Abend“              | Ja (Serie)    | Meetup, Website                      |

## Datenmodell (grob)

- **Submission:** Rohtext, Absender (Matrix-ID), Zeitpunkt
- **Draft:** Postart, extrahierte Felder, Status (`collecting` → `ready` → `in_review` → `approved` / `changes_requested` → `published`)
- **ChannelPost:** ein Entwurf pro Kanal (Text, Bilder, Ziel-ID nach dem Veröffentlichen)
- **Asset:** Bild in der Bibliothek, Uploader, Tags, Embedding, Freigabe für Wiederverwendung (ja/nein)
- **Review:** wer, wann, Ergebnis, Kommentar

## Technische Leitplanken

- Nx-Monorepo (TypeScript). Vermutliche Aufteilung:
  - `apps/bot`: Matrix-Bot (Eingabe und Freigabe)
  - `apps/web`: Admin-Oberfläche und optional Eingabeformular
  - `apps/worker`: Hintergrundjobs (Embeddings, Veröffentlichung)
  - `packages/core`: Domänenlogik (Drafts, Zustandsautomat)
  - `packages/ai`: LLM-Abstraktion (Ollama, OpenAI-kompatibel)
  - `packages/channels/*`: Adapter für Meetup, Instagram, Facebook, WordPress
  - `packages/media-library`: Speicher und Suche
- Deployment als Docker-Images auf Coolify.
- Datenbank: Postgres (mit `pgvector` für die Bildsuche).
