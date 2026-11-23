import { berlinToInstant, HttpError, type FetchLike } from '@postomat/core';

/** One VEVENT from the Meetup feed. */
export interface FeedEvent {
  uid: string;
  /** Meetup event id from `UID:event_<id>@meetup.com` or the URL. */
  meetupId: string;
  summary: string;
  description: string;
  url: string;
  start: Date;
  end?: Date;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseDate(
  value: string,
  params: Record<string, string>,
): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    value.trim(),
  );
  if (!m) return undefined;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return berlinToInstant(`${y}-${mo}-${d}`, '00:00');
  if (z)
    return new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss ?? 0),
      ),
    );
  // TZID=Europe/Berlin or floating time → Berlin wall clock (the club's zone).
  void params;
  return berlinToInstant(`${y}-${mo}-${d}`, `${hh}:${mm}`);
}

export function meetupIdFrom(uid: string, url: string): string {
  return (
    /event_([^@]+)@/.exec(uid)?.[1] ??
    /\/events\/([^/]+)\/?/.exec(url)?.[1] ??
    uid
  );
}

/** Parses an iCalendar text into events (only what Postomat needs). */
export function parseIcal(text: string): FeedEvent[] {
  const events: FeedEvent[] = [];
  let cur: Record<
    string,
    { value: string; params: Record<string, string> }
  > | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        const uid = cur['UID']?.value ?? '';
        const url = cur['URL']?.value ?? '';
        const start = cur['DTSTART']
          ? parseDate(cur['DTSTART'].value, cur['DTSTART'].params)
          : undefined;
        if (uid && start) {
          events.push({
            uid,
            meetupId: meetupIdFrom(uid, url),
            summary: unescapeText(cur['SUMMARY']?.value ?? ''),
            description: unescapeText(cur['DESCRIPTION']?.value ?? ''),
            url,
            start,
            end: cur['DTEND']
              ? parseDate(cur['DTEND'].value, cur['DTEND'].params)
              : undefined,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...paramParts] = line.slice(0, idx).split(';');
    const params = Object.fromEntries(
      paramParts.map((p) => p.split('=') as [string, string]),
    );
    cur[name.toUpperCase()] = { value: line.slice(idx + 1), params };
  }
  return events;
}

export async function fetchFeed(
  url: string,
  fetchFn: FetchLike = fetch,
): Promise<FeedEvent[]> {
  const res = await fetchFn(url, {
    headers: { accept: 'text/calendar', 'user-agent': 'Postomat/1.0' },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(`GET ${url}`, res.status, text);
  return parseIcal(text);
}
