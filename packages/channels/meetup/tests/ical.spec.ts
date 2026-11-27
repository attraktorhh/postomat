import { describe, expect, it } from 'vitest';
import { parseIcal } from '../src/index.ts';

const event = (...lines: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event_1@meetup.com',
    ...lines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

const startOf = (...lines: string[]) =>
  parseIcal(event(...lines))[0]?.start.toISOString();

describe('parseIcal times', () => {
  it('reads UTC times as absolute instants', () => {
    expect(startOf('DTSTART:20261211T180000Z')).toBe(
      '2026-12-11T18:00:00.000Z',
    );
  });

  it('reads TZID times in that zone', () => {
    expect(startOf('DTSTART;TZID=America/New_York:20261211T180000')).toBe(
      '2026-12-11T23:00:00.000Z',
    );
    expect(startOf('DTSTART;TZID="Europe/London":20260701T180000')).toBe(
      '2026-07-01T17:00:00.000Z',
    );
  });

  it('reads floating times and unknown TZIDs as Berlin time', () => {
    expect(startOf('DTSTART:20261211T180000')).toBe('2026-12-11T17:00:00.000Z');
    expect(startOf('DTSTART;TZID=Not/AZone:20261211T180000')).toBe(
      '2026-12-11T17:00:00.000Z',
    );
  });

  it('reads all-day dates as Berlin midnight', () => {
    expect(startOf('DTSTART;VALUE=DATE:20261211')).toBe(
      '2026-12-10T23:00:00.000Z',
    );
  });

  it('uses the TZID even when the feed carries a VTIMEZONE', () => {
    const [e] = parseIcal(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTIMEZONE',
        'TZID:Europe/Berlin',
        'BEGIN:STANDARD',
        'DTSTART:19701025T030000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0100',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:event_5@meetup.com',
        'DTSTART;TZID=Europe/Berlin:20260701T190000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    expect(e.start.toISOString()).toBe('2026-07-01T17:00:00.000Z');
  });
});

describe('parseIcal text', () => {
  it('unescapes an escaped backslash before n as a backslash', () => {
    const [e] = parseIcal(
      event('DTSTART:20261211T180000Z', 'SUMMARY:C:\\\\new\\, ok\\nnext'),
    );
    expect(e.summary).toBe('C:\\new, ok\nnext');
  });

  it('unfolds folded lines (CRLF and LF, space and tab)', () => {
    const [e] = parseIcal(
      event(
        'DTSTART:20261211T180000Z',
        'SUMMARY:Löt',
        ' kurs',
        'DESCRIPTION:a',
        '\tb',
      ),
    );
    expect(e.summary).toBe('Lötkurs');
    expect(e.description).toBe('ab');
    const [lf] = parseIcal(
      'BEGIN:VEVENT\nUID:event_2@meetup.com\nDTSTART:20261211T180000Z\nSUMMARY:Löt\n kurs\nEND:VEVENT',
    );
    expect(lf.summary).toBe('Lötkurs');
  });

  it('skips events without DTSTART and throws on malformed iCal', () => {
    expect(parseIcal(event('SUMMARY:x'))).toEqual([]);
    expect(() => parseIcal('not ical at all')).toThrow();
  });
});
