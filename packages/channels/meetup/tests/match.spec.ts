import { describe, expect, it } from 'vitest';
import { renderMeetupIcal, type FakeMeetupEvent } from '@postomat/testing';
import { matchMeetupEvent, normalizeTitle, parseIcal, titleSimilarity } from '../src/index.ts';

// Fixture in the real feed format (VTIMEZONE, TZID, UID event_<id>@meetup.com, URL;VALUE=URI, folding).
const REAL_FORMAT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Meetup//RemoteApi//EN',
  'BEGIN:VEVENT',
  'DTSTAMP:20261123T120000Z',
  'DTSTART;TZID=Europe/Berlin:20261211T180000',
  'DTEND;TZID=Europe/Berlin:20261211T210000',
  'STATUS:CONFIRMED',
  'SUMMARY:🔥 Lötkurs für Anfänger / Soldering for beginners',
  'DESCRIPTION:Du wolltest schon immer mal löten?\\n\\nKeine Vorkenntnisse nötig\\, Lötstationen sind',
  '  vorhanden.',
  'URL;VALUE=URI:https://www.meetup.com/attraktor/events/312070001/',
  'UID:event_312070001@meetup.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const post = { title: 'Lötkurs für Anfänger', date: '2026-12-11', startTime: '18:00' };
const feed = (events: FakeMeetupEvent[]) => parseIcal(renderMeetupIcal(events));

describe('parseIcal', () => {
  it('reads the real feed format', () => {
    const [e] = parseIcal(REAL_FORMAT);
    expect(e.meetupId).toBe('312070001');
    expect(e.summary).toBe('🔥 Lötkurs für Anfänger / Soldering for beginners');
    expect(e.description).toBe('Du wolltest schon immer mal löten?\n\nKeine Vorkenntnisse nötig, Lötstationen sind vorhanden.');
    expect(e.start.toISOString()).toBe('2026-12-11T17:00:00.000Z');
    expect(e.end?.toISOString()).toBe('2026-12-11T20:00:00.000Z');
  });

  it('handles UTC and summer time', () => {
    const [utc] = parseIcal('BEGIN:VEVENT\nUID:event_1@meetup.com\nDTSTART:20260701T170000Z\nEND:VEVENT');
    expect(utc.start.toISOString()).toBe('2026-07-01T17:00:00.000Z');
    const [summer] = parseIcal('BEGIN:VEVENT\nUID:event_2@meetup.com\nDTSTART;TZID=Europe/Berlin:20260701T190000\nEND:VEVENT');
    expect(summer.start.toISOString()).toBe('2026-07-01T17:00:00.000Z');
  });
});

describe('title similarity', () => {
  it('normalises emoji, punctuation and the English part', () => {
    expect(normalizeTitle('🔥 Lötkurs für Anfänger! / Soldering')).toBe('lötkurs für anfänger');
    expect(titleSimilarity('Lötkurs für Anfänger', '🔥 Lötkurs für Anfänger / Soldering for beginners')).toBe(1);
    expect(titleSimilarity('Lötkurs für Anfänger', 'Handarbeitstreff')).toBeLessThan(0.3);
  });
});

describe('matchMeetupEvent', () => {
  it('links exactly one strong match', () => {
    const r = matchMeetupEvent(post, parseIcal(REAL_FORMAT), new Set());
    expect(r.kind).toBe('strong');
  });

  it('accepts a start within ±60 minutes and a slightly different title', () => {
    const r = matchMeetupEvent(post, feed([{ id: '1', title: 'Lötkurs für Anfänger*innen', start: '2026-12-11T18:30' }]), new Set());
    expect(r.kind).toBe('strong');
  });

  it('reports no match on another day or with an unrelated title', () => {
    expect(matchMeetupEvent(post, feed([{ id: '1', title: 'Lötkurs für Anfänger', start: '2026-12-12T18:00' }]), new Set()).kind).toBe('none');
    expect(matchMeetupEvent(post, feed([{ id: '2', title: 'Basteldonnerstag', start: '2026-12-11T19:00' }]), new Set()).kind).toBe('none');
  });

  it('asks when the same day has only weak candidates', () => {
    const r = matchMeetupEvent(post, feed([{ id: '1', title: 'Lötkurs', start: '2026-12-11T18:00' }]), new Set());
    expect(r.kind).toBe('ambiguous');
  });

  it('asks when several strong matches exist', () => {
    const r = matchMeetupEvent(
      post,
      feed([
        { id: '1', title: 'Lötkurs für Anfänger', start: '2026-12-11T18:00' },
        { id: '2', title: 'Lötkurs für Anfänger (Gruppe 2)', start: '2026-12-11T18:30' },
      ]),
      new Set(),
    );
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  it('ignores events already linked to another post', () => {
    const r = matchMeetupEvent(post, feed([{ id: '1', title: 'Lötkurs für Anfänger', start: '2026-12-11T18:00' }]), new Set(['1']));
    expect(r.kind).toBe('none');
  });

  it('uses the local Berlin date across DST (late event on the switch day)', () => {
    const dstPost = { title: 'Nachtlöten', date: '2027-03-28', startTime: '23:30' };
    // 23:30 CEST on 28.03. is 21:30Z, still the 28th locally.
    const r = matchMeetupEvent(dstPost, feed([{ id: '9', title: 'Nachtlöten', start: '2027-03-28T23:30' }]), new Set());
    expect(r.kind).toBe('strong');
    const winter = { title: 'Nachtlöten', date: '2026-10-25', startTime: '00:30' };
    expect(matchMeetupEvent(winter, feed([{ id: '8', title: 'Nachtlöten', start: '2026-10-25T00:30' }]), new Set()).kind).toBe('strong');
  });
});
