import { describe, expect, it } from 'vitest';
import {
  aiFactsSchema,
  emptyAiFacts,
  interpretationSchema,
  validateAiFacts,
} from '../src/index.ts';

const NOW = new Date('2026-11-23T13:02:00Z'); // Monday in Berlin

describe('validateAiFacts', () => {
  it.each([0, -1, 3.5, 10001])('rejects %s places', (places) => {
    const r = validateAiFacts({ places }, { now: NOW, type: 'event' });
    expect(r.facts.places).toBeUndefined();
    expect(r.rejected).toEqual([{ key: 'places', reason: 'invalid_places' }]);
  });

  it('accepts a plausible number of places', () => {
    expect(validateAiFacts({ places: 8 }, { now: NOW }).facts.places).toBe(8);
  });

  it('rejects a title over 120 characters', () => {
    const r = validateAiFacts({ title: 'x'.repeat(121) }, { now: NOW });
    expect(r.facts.title).toBeUndefined();
    expect(r.rejected).toEqual([{ key: 'title', reason: 'too_long' }]);
  });

  it('accepts a past date for a Projekt but not for an Event', () => {
    expect(
      validateAiFacts({ date: '2026-10-01' }, { now: NOW, type: 'projekt' })
        .facts.date,
    ).toBe('2026-10-01');
    expect(
      validateAiFacts({ date: '2026-10-01' }, { now: NOW, type: 'event' })
        .rejected,
    ).toEqual([{ key: 'date', reason: 'past_date' }]);
  });

  it('compares an end time with the start time stored earlier', () => {
    const known = { startTime: '18:00' };
    expect(
      validateAiFacts({ endTime: '17:00' }, { now: NOW, known }).rejected,
    ).toEqual([{ key: 'endTime', reason: 'end_before_start' }]);
    expect(
      validateAiFacts({ endTime: '21:00' }, { now: NOW, known }).facts.endTime,
    ).toBe('21:00');
  });

  it('a start time in the same message wins over the stored one', () => {
    const r = validateAiFacts(
      { startTime: '16:00', endTime: '17:00' },
      { now: NOW, known: { startTime: '18:00' } },
    );
    expect(r.facts).toEqual({ startTime: '16:00', endTime: '17:00' });
  });
});

describe('AI result contract', () => {
  it('emptyAiFacts has every schema key, all null', () => {
    const empty = emptyAiFacts();
    expect(Object.keys(empty).sort()).toEqual(
      Object.keys(aiFactsSchema.shape).sort(),
    );
    expect(Object.values(empty).every((v) => v === null)).toBe(true);
  });

  it('limits instruction and note length', () => {
    const base = {
      intent: 'request_text_change',
      type: null,
      facts: emptyAiFacts(),
      consent: null,
      instruction: 'kürzer',
      text: null,
    };
    expect(interpretationSchema.safeParse(base).success).toBe(true);
    expect(
      interpretationSchema.safeParse({ ...base, instruction: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });
});
