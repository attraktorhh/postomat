import { describe, expect, it } from 'vitest';
import { extractDate, extractFacts, isWorkshopText } from '../src/extract.ts';
import {
  addMinutesToTime,
  berlinToInstant,
  localDateOf,
  localTimeOf,
} from '../src/time.ts';

// Monday, 23.11.2026, 14:02 in Hamburg.
const NOW = new Date('2026-11-23T13:02:00Z');

describe('parser does not invent facts', () => {
  it('a count range is not a time', () => {
    const f = extractFacts(
      'Ich möchte am Freitag einen Lötkurs für 6-8 Leute machen, 18 Uhr',
      { now: NOW },
    );
    expect(f.startTime).toBe('18:00');
    expect(f.endTime).toBeUndefined();
  });

  it('a price range is not a time', () => {
    const f = extractFacts('Kostet 5-10 €, Treffen um 18 Uhr', { now: NOW });
    expect(f.startTime).toBe('18:00');
    expect(f.endTime).toBeUndefined();
  });

  it('"ab 12 Jahren" is an age, not a start time', () => {
    expect(
      extractFacts('Für Jugendliche ab 12 Jahren', { now: NOW }).startTime,
    ).toBeUndefined();
    expect(
      extractFacts('Wir löten Blinker, für Jugendliche ab 12 Jahren.', {
        now: NOW,
        expecting: 'description',
      }).startTime,
    ).toBeUndefined();
  });

  it('"so." at the end of a sentence is not Sunday', () => {
    expect(extractDate('Wir löten Blinker, einfach so.', NOW)).toBeUndefined();
    expect(extractDate('Fr. 18 Uhr', NOW)).toBe('2026-11-27');
  });

  it('a description only yields explicit dates and times', () => {
    const f = extractFacts('Wir treffen uns sonst jeden Freitag um 19.', {
      now: NOW,
      expecting: 'description',
    });
    expect(f.date).toBeUndefined();
    expect(f.startTime).toBeUndefined();
    const g = extractFacts('Nee, doch am 11.12.! 18 Uhr', {
      now: NOW,
      expecting: 'description',
    });
    expect(g.date).toBe('2026-12-11');
    expect(g.startTime).toBe('18:00');
  });

  it('still reads real ranges', () => {
    for (const t of ['18-21 Uhr', 'von 18 bis 21', '18:00 - 21:00', '18–21h'])
      expect(extractFacts(t, { now: NOW })).toMatchObject({
        startTime: '18:00',
        endTime: '21:00',
      });
  });

  it('workshop keyword is "workshop" or "kurs" only', () => {
    expect(isWorkshopText('Lötkurs für Anfänger')).toBe(true);
    expect(isWorkshopText('Arduino-Workshop')).toBe(true);
    expect(isWorkshopText('Einführung in den Lasercutter')).toBe(false);
    expect(isWorkshopText('Wir lernen löten')).toBe(false);
  });
});

describe('Berlin time around midnight and DST', () => {
  it('"morgen" late on Monday evening (UTC still Monday) is Wednesday', () => {
    // 2026-11-23T23:30Z is already Tuesday 00:30 in Berlin.
    const now = new Date('2026-11-23T23:30:00Z');
    expect(localDateOf(now)).toBe('2026-11-24');
    expect(extractDate('morgen', now)).toBe('2026-11-25');
  });

  it('a time in the March gap (02:30 does not exist) moves forward', () => {
    const t = berlinToInstant('2027-03-28', '02:30');
    expect(localDateOf(t)).toBe('2027-03-28');
    expect(['01:30', '03:30']).toContain(localTimeOf(t));
    // Times around the gap stay exact.
    expect(berlinToInstant('2027-03-28', '01:30').toISOString()).toBe(
      '2027-03-28T00:30:00.000Z',
    );
    expect(berlinToInstant('2027-03-28', '03:30').toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
  });

  it('the doubled 02:30 in October maps to one valid instant', () => {
    const t = berlinToInstant('2026-10-25', '02:30');
    expect(localTimeOf(t)).toBe('02:30');
    expect(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']).toContain(
      t.toISOString(),
    );
    expect(berlinToInstant('2026-10-25', '18:00').toISOString()).toBe(
      '2026-10-25T17:00:00.000Z',
    );
  });

  it('end times wrap at midnight', () => {
    expect(addMinutesToTime('22:00', 180)).toBe('01:00');
  });
});
