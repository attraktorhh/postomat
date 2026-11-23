import type { FactKey, PostFacts, PostType } from './types.ts';
import { addDays, isValidDate, localDateOf, pad2, weekdayOf } from './time.ts';

/**
 * Deterministic fact extraction for German chat messages. Used without AI and as
 * the fallback when the AI provider fails. All dates are relative to `now` in
 * Europe/Berlin.
 */
export interface ExtractOptions {
  now: Date;
  /** The field the bot just asked for. A bare answer ("8", "18") fills it. */
  expecting?: FactKey;
}

const WEEKDAY_PATTERNS: Array<[RegExp, number]> = [
  [/\b(sonntags?|so\.)(?=\s|$|[,.!?])/i, 0],
  [/\b(montags?|mo\.)(?=\s|$|[,.!?])/i, 1],
  [/\b(dienstags?|di\.)(?=\s|$|[,.!?])/i, 2],
  [/\b(mittwochs?|mi\.)(?=\s|$|[,.!?])/i, 3],
  [/\b(donnerstags?|do\.)(?=\s|$|[,.!?])/i, 4],
  [/\b(freitags?|fr\.)(?=\s|$|[,.!?])/i, 5],
  [/\b(samstags?|sonnabends?|sa\.)(?=\s|$|[,.!?])/i, 6],
];

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

function nextOccurrence(today: string, month: number, day: number, year?: number): string | undefined {
  const [ty] = today.split('-').map(Number);
  if (year !== undefined) {
    const full = year < 100 ? 2000 + year : year;
    const date = `${full}-${pad2(month)}-${pad2(day)}`;
    return isValidDate(date) ? date : undefined;
  }
  for (const y of [ty, ty + 1]) {
    const date = `${y}-${pad2(month)}-${pad2(day)}`;
    if (isValidDate(date) && date >= today) return date;
  }
  return undefined;
}

/** Extracts a local date from German text. Explicit dates win over weekdays. */
export function extractDate(text: string, now: Date): string | undefined {
  const today = localDateOf(now);
  const t = text.toLowerCase();

  // 11.12. / 11.12.2026 / 11.12.26 (but not times like 18.30 Uhr)
  const explicit = /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(\d{2,4})?(?!\s*uhr)(?![\d])/i.exec(t);
  if (explicit) {
    const d = nextOccurrence(
      today,
      Number(explicit[2]),
      Number(explicit[1]),
      explicit[3] ? Number(explicit[3]) : undefined,
    );
    if (d) return d;
  }
  // 11. Dezember (2026)
  const named = /(?<!\d)(\d{1,2})\.?\s+([a-zäö]+)\.?(?:\s+(\d{4}))?/i.exec(t);
  if (named && MONTHS[named[2]] !== undefined) {
    const d = nextOccurrence(today, MONTHS[named[2]], Number(named[1]), named[3] ? Number(named[3]) : undefined);
    if (d) return d;
  }
  // ISO 2026-12-11
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso && isValidDate(iso[0])) return iso[0];

  if (/(?<!\p{L})übermorgen(?!\p{L})/u.test(t)) return addDays(today, 2);
  if (/\bmorgen\b/.test(t) && !/\bmorgens\b/.test(t)) return addDays(today, 1);
  if (/\bheute\b/.test(t)) return today;

  for (const [pattern, weekday] of WEEKDAY_PATTERNS) {
    const m = pattern.exec(t);
    if (!m) continue;
    const before = t.slice(Math.max(0, m.index - 20), m.index);
    let diff = (weekday - weekdayOf(today) + 7) % 7;
    if (diff === 0) diff = 7;
    // "nächsten Freitag" means the upcoming Friday in everyday German.
    if (/übernächste[nm]?\s*$/.test(before)) diff += 7;
    return addDays(today, diff);
  }
  return undefined;
}

const toTime = (h: string, m?: string): string | undefined => {
  const hh = Number(h);
  const mm = m ? Number(m) : 0;
  if (hh > 23 || mm > 59) return undefined;
  return `${pad2(hh)}:${pad2(mm)}`;
};

/** Extracts start (and optional end) time. */
export function extractTimes(text: string, bare = false): { startTime?: string; endTime?: string } {
  const t = text.toLowerCase().replace(/[–—]/g, '-');
  const hm = '(\\d{1,2})(?:[:.](\\d{2}))?';
  // 18-21 Uhr, 18:00 - 21:00, von 18 bis 21 Uhr
  const range = new RegExp(`(?:von\\s+)?(?<![\\d.])${hm}\\s*(?:uhr\\s*)?(?:-|bis)\\s*${hm}\\s*(uhr|h\\b)?`, 'i').exec(t);
  if (range && (range[5] || range[2] || range[4] || /\buhr\b/.test(t.slice(range.index)))) {
    const start = toTime(range[1], range[2]);
    const end = toTime(range[3], range[4]);
    if (start && end) return { startTime: start, endTime: end };
  }
  // 18:00 / 18.30 Uhr / 18 Uhr / um 18
  const withColon = /(?<![\d.])(\d{1,2}):(\d{2})(?!\d)/.exec(t);
  if (withColon) {
    const start = toTime(withColon[1], withColon[2]);
    if (start) return { startTime: start };
  }
  const withUhr = new RegExp(`(?<![\\d.])${hm}\\s*(?:uhr|h\\b)`, 'i').exec(t);
  if (withUhr) {
    const start = toTime(withUhr[1], withUhr[2]);
    if (start) return { startTime: start };
  }
  const um = /\b(?:um|ab)\s+(\d{1,2})(?:[:.](\d{2}))?(?![\d.])/.exec(t);
  if (um) {
    const start = toTime(um[1], um[2]);
    if (start) return { startTime: start };
  }
  if (bare) {
    const only = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(t);
    if (only) {
      const start = toTime(only[1], only[2]);
      if (start) return { startTime: start };
    }
  }
  return {};
}

export function extractPlaces(text: string, bare = false): number | undefined {
  const t = text.toLowerCase();
  const m =
    /(\d{1,3})\s*(?:leute|plätze|plaetze|personen|teilnehmer(?:\*innen|innen)?|tn|menschen|leuten)\b/.exec(t) ??
    /\b(?:max\.?|maximal|höchstens|bis zu|für)\s*(\d{1,3})\b(?!\s*(?:€|euro|uhr))/.exec(t);
  if (m) return Number(m[1]);
  if (bare) {
    const only = /^\s*(\d{1,3})\s*$/.exec(t);
    if (only) return Number(only[1]);
    if (/\b(unbegrenzt|egal|offen|beliebig)\b/.test(t)) return undefined;
  }
  return undefined;
}

export function extractCosts(text: string, bare = false): string | undefined {
  const t = text.toLowerCase();
  if (/\b(kostenlos|umsonst|gratis|kostet nichts|for free|keine kosten)\b/.test(t)) return 'kostenlos';
  const m = /(?:€\s*(\d+(?:[.,]\d{1,2})?))|(?:(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b))/.exec(t);
  if (m) {
    const amount = (m[1] ?? m[2]).replace('.', ',');
    const material = /material/.test(t) ? ' Material' : '';
    return `${amount} €${material}`;
  }
  if (bare) {
    if (/^\s*(nein|nö|ne|nee|nichts|0)\s*[.!]?\s*$/.test(t)) return 'kostenlos';
    const only = /^\s*(\d+(?:[.,]\d{1,2})?)\s*$/.exec(t);
    if (only) return `${only[1].replace('.', ',')} €`;
  }
  return undefined;
}

const WORKSHOP_RE = /(workshop|kurs\b|kurs[ e]|lötkurs|einführung|anfänger|lernen|schulung)/i;

export function isWorkshopText(text: string): boolean {
  return WORKSHOP_RE.test(text);
}

const DATE_WORDS =
  /(?<!\p{L})(am|ab|um|übernächste[nm]?|nächste[nm]?|kommende[nm]?|diese[nm]?|übermorgen|morgen|heute|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?!\p{L})/giu;

function cleanTitle(raw: string): string {
  const s = raw
    .replace(DATE_WORDS, ' ')
    .replace(/(?<![\d.])\d{1,2}\.\s?\d{1,2}\.(\d{2,4})?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,!?]+$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best-effort title from a free sentence ("… einen Lötkurs für Anfänger machen"). */
export function guessTitle(text: string): string | undefined {
  const t = text.trim();
  const event =
    /\b(?:einen|eine|ein|nen|'nen)\s+(.+?)\s+(?:machen|anbieten|veranstalten|geben|halten|organisieren|starten|durchführen)\b/i.exec(
      t,
    );
  if (event) return cleanTitle(event[1]) || undefined;
  const project =
    /\b(?:habe|hab|haben)\s+(?:mir\s+)?(?:einen|eine|ein|nen)\s+(.+?)\s+(?:gebaut|gebastelt|gemacht|entwickelt|programmiert|gedruckt|restauriert|repariert)\b/i.exec(
      t,
    );
  if (project) return cleanTitle(project[1]) || undefined;
  return undefined;
}

/** Guesses the post type from a free sentence. Undefined when unclear. */
export function guessType(text: string, now: Date): PostType | undefined {
  const t = text.toLowerCase();
  if (/\b(gebaut|gebastelt|fertig geworden|projekt|restauriert|programmiert)\b/.test(t)) return 'projekt';
  if (extractDate(t, now) || /(workshop|kurs|treffen|vortrag|stammtisch|abend|event|veranstalt|machen)/.test(t)) {
    return 'event';
  }
  return undefined;
}

/**
 * Extracts every fact it can find in one message. Free-text fields are only
 * filled when the bot explicitly asked for them (`expecting`).
 */
export function extractFacts(text: string, opts: ExtractOptions): PostFacts {
  const facts: PostFacts = {};
  const { expecting } = opts;
  const trimmed = text.trim();

  // Explicit "Feld: Wert" corrections always work.
  const labelled = /^(titel|title)\s*:\s*(.+)$/im.exec(trimmed);
  if (labelled) facts.title = labelled[2].trim();

  if (expecting === 'title' && !labelled) facts.title = trimmed.replace(/[.!]+$/, '');
  if (expecting === 'description') facts.description = trimmed;
  if (expecting === 'trickiest') facts.trickiest = trimmed;
  if (expecting === 'audience') facts.audience = trimmed;

  const date = extractDate(trimmed, opts.now);
  if (date) facts.date = date;
  const times = extractTimes(trimmed, expecting === 'startTime');
  if (times.startTime) facts.startTime = times.startTime;
  if (times.endTime) facts.endTime = times.endTime;
  const places = extractPlaces(trimmed, expecting === 'places');
  if (places !== undefined) facts.places = places;
  const costs = extractCosts(trimmed, expecting === 'costs');
  if (costs) facts.costs = costs;
  if (isWorkshopText(trimmed)) facts.isWorkshop = true;
  return facts;
}
