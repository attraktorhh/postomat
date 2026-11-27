import { describe, expect, it } from 'vitest';
import {
  berlinToInstant,
  localDateOf,
  localTimeOf,
  zonedParts,
  zonedToInstant,
} from '../src/index.ts';

describe('Berlin wall clock <-> instant', () => {
  it('converts winter and summer times', () => {
    expect(berlinToInstant('2026-12-11', '18:00').toISOString()).toBe(
      '2026-12-11T17:00:00.000Z',
    );
    expect(berlinToInstant('2026-07-01', '19:00').toISOString()).toBe(
      '2026-07-01T17:00:00.000Z',
    );
    expect(berlinToInstant('2026-12-11').toISOString()).toBe(
      '2026-12-10T23:00:00.000Z',
    );
  });

  it('reads instants as Berlin date, time and parts', () => {
    const t = new Date('2026-12-31T23:30:15Z');
    expect(localDateOf(t)).toBe('2027-01-01');
    expect(localTimeOf(t)).toBe('00:30');
    expect(zonedParts(t)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30,
      second: 15,
    });
  });

  // 2026-03-29 02:00 → 03:00: 02:30 does not exist. It is read with the
  // offset before the gap (+01:00), i.e. 03:30 summer time (RFC 5545).
  it('moves a time in the spring-forward gap forward by an hour', () => {
    const t = berlinToInstant('2026-03-29', '02:30');
    expect(t.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localTimeOf(t)).toBe('03:30');
    expect(berlinToInstant('2026-03-29', '01:59').toISOString()).toBe(
      '2026-03-29T00:59:00.000Z',
    );
    expect(berlinToInstant('2026-03-29', '03:00').toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    );
  });

  // 2026-10-25 03:00 → 02:00: 02:30 happens twice. The second occurrence
  // (winter time, +01:00) is used, whatever the host's time zone.
  it('picks the second occurrence in the autumn overlap', () => {
    const t = berlinToInstant('2026-10-25', '02:30');
    expect(t.toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(localTimeOf(t)).toBe('02:30');
    expect(localTimeOf(new Date('2026-10-25T01:30:00Z'))).toBe('02:30');
    expect(berlinToInstant('2026-10-25', '03:00').toISOString()).toBe(
      '2026-10-25T02:00:00.000Z',
    );
  });

  it('converts other zones and seconds', () => {
    expect(
      zonedToInstant(
        '2026-12-11',
        '18:00:30',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-12-11T23:00:30.000Z');
  });
});
