import ICAL from 'ical.js';
import {
  berlinToInstant,
  HttpError,
  isValidTimeZone,
  pad2,
  timeoutSignal,
  TIMEZONE,
  zonedToInstant,
  type FetchLike,
} from '@postomat/core';

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

/**
 * Instant of a DTSTART/DTEND property. UTC (`Z`) times are absolute, times
 * with a known IANA `TZID` are read in that zone, floating times and all-day
 * dates in Europe/Berlin (the club's zone).
 */
function instantOf(prop: ICAL.Property | null): Date | undefined {
  const value = prop?.getFirstValue();
  if (!(value instanceof ICAL.Time)) return undefined;
  const date = `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
  if (value.isDate) return berlinToInstant(date, '00:00');
  if (value.zone === ICAL.Timezone.utcTimezone) return value.toJSDate();
  const tzid = prop?.getParameter('tzid');
  const zone =
    typeof tzid === 'string' && isValidTimeZone(tzid) ? tzid : TIMEZONE;
  const time = `${pad2(value.hour)}:${pad2(value.minute)}:${pad2(value.second)}`;
  return zonedToInstant(date, time, zone);
}

function textOf(event: ICAL.Component, name: string): string {
  const v = event.getFirstPropertyValue(name);
  return typeof v === 'string' ? v : '';
}

/** All VEVENTs, whether wrapped in a VCALENDAR or not. */
function veventsOf(text: string): ICAL.Component[] {
  // jCal: one root is `[name, props, comps]`, several roots an array of those.
  const parsed = ICAL.parse(text) as unknown[];
  const roots = (Array.isArray(parsed[0]) ? parsed : [parsed]) as unknown[][];
  return roots
    .map((jcal) => new ICAL.Component(jcal))
    .flatMap((c) =>
      c.name === 'vevent' ? [c] : c.getAllSubcomponents('vevent'),
    );
}

/** Numeric Meetup event id from `UID:event_<id>@meetup.com` or the URL; null if none. */
export function meetupIdFrom(uid: string, url: string): string | null {
  return (
    /^event_(\d+)@/.exec(uid)?.[1] ??
    /\/events\/(\d+)(?:[/?#]|$)/.exec(url)?.[1] ??
    null
  );
}

/**
 * The event URL goes into links on the blog, the wiki and DMs, so only a
 * meetup.com URL is accepted. Otherwise a canonical one is built from the id.
 */
function meetupUrlFrom(url: string, id: string): string {
  return /^https:\/\/www\.meetup\.com\/[^\s"<>]+$/.test(url)
    ? url
    : `https://www.meetup.com/events/${id}/`;
}

/** Parses an iCalendar text into events (only what Postomat needs). Throws on malformed iCal. */
export function parseIcal(text: string): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const vevent of veventsOf(text)) {
    const uid = textOf(vevent, 'uid');
    const url = textOf(vevent, 'url');
    const start = instantOf(vevent.getFirstProperty('dtstart'));
    const meetupId = meetupIdFrom(uid, url);
    // Feed data is untrusted: skip entries without a numeric event id.
    if (!uid || !start || !meetupId) continue;
    events.push({
      uid,
      meetupId,
      summary: textOf(vevent, 'summary'),
      description: textOf(vevent, 'description'),
      url: meetupUrlFrom(url, meetupId),
      start,
      end: instantOf(vevent.getFirstProperty('dtend')),
    });
  }
  return events;
}

export async function fetchFeed(
  url: string,
  fetchFn: FetchLike = fetch,
): Promise<FeedEvent[]> {
  const res = await fetchFn(url, {
    signal: timeoutSignal(),
    headers: { accept: 'text/calendar', 'user-agent': 'Postomat/1.0' },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(`GET ${url}`, res.status, text);
  return parseIcal(text);
}
