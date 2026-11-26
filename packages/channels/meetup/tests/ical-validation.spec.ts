import { describe, expect, it } from 'vitest';
import { meetupIdFrom, parseIcal } from '../src/index.ts';

const vevent = (uid: string, url: string) =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Berlin:20261211T180000',
    'SUMMARY:Lötkurs',
    `URL;VALUE=URI:${url}`,
    `UID:${uid}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

describe('iCal input validation (the feed is untrusted)', () => {
  it('accepts only numeric Meetup event ids', () => {
    expect(meetupIdFrom('event_312070001@meetup.com', '')).toBe('312070001');
    expect(
      meetupIdFrom('x', 'https://www.meetup.com/attraktor/events/42/'),
    ).toBe('42');
    expect(meetupIdFrom('event_1}}{{x@meetup.com', '')).toBeNull();
    expect(meetupIdFrom('random-uid', 'https://evil.example/')).toBeNull();
  });

  it('skips events without a numeric id', () => {
    expect(parseIcal(vevent('event_abc@meetup.com', ''))).toEqual([]);
  });

  it('replaces a non-meetup.com URL with a canonical event URL', () => {
    const [e] = parseIcal(vevent('event_77@meetup.com', 'javascript:alert(1)'));
    expect(e.url).toBe('https://www.meetup.com/events/77/');
    const [ok] = parseIcal(
      vevent(
        'event_78@meetup.com',
        'https://www.meetup.com/attraktor/events/78/',
      ),
    );
    expect(ok.url).toBe('https://www.meetup.com/attraktor/events/78/');
  });
});
