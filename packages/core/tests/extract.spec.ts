import { describe, expect, it } from 'vitest';
import { extractDate, extractFacts, extractTimes, guessTitle, guessType } from '../src/extract.ts';

// Monday, 23.11.2026, 14:02 in Hamburg.
const NOW = new Date('2026-11-23T13:02:00Z');

describe('extractDate', () => {
  it.each([
    ['11.12.', '2026-12-11'],
    ['am 11.12.2026', '2026-12-11'],
    ['am 11.12.26', '2026-12-11'],
    ['11. Dezember', '2026-12-11'],
    ['am 3.1.', '2027-01-03'],
    ['Freitag', '2026-11-27'],
    ['nächsten Freitag', '2026-11-27'],
    ['übernächsten Freitag', '2026-12-04'],
    ['am Montag', '2026-11-30'],
    ['morgen', '2026-11-24'],
    ['übermorgen', '2026-11-25'],
    ['heute', '2026-11-23'],
    ['Nee, den Freitag danach, also 11.12.!', '2026-12-11'],
  ])('%s → %s', (text, expected) => {
    expect(extractDate(text, NOW)).toBe(expected);
  });

  it('does not read times as dates', () => {
    expect(extractDate('um 18.30 Uhr', NOW)).toBeUndefined();
  });

  it('rolls an already passed date into the next year', () => {
    expect(extractDate('am 1.11.', NOW)).toBe('2027-11-01');
  });

  it('handles the DST boundary (last Sunday in March)', () => {
    const march = new Date('2027-03-27T12:00:00Z'); // Saturday before DST switch
    expect(extractDate('morgen', march)).toBe('2027-03-28');
    expect(extractDate('Sonntag', march)).toBe('2027-03-28');
  });
});

describe('extractTimes', () => {
  it.each([
    ['18 Uhr', { startTime: '18:00' }],
    ['18:00', { startTime: '18:00' }],
    ['um 18.30 Uhr', { startTime: '18:30' }],
    ['18–21 Uhr', { startTime: '18:00', endTime: '21:00' }],
    ['von 18 bis 21 Uhr', { startTime: '18:00', endTime: '21:00' }],
    ['18:00 - 21:30', { startTime: '18:00', endTime: '21:30' }],
    ['ab 19:30', { startTime: '19:30' }],
  ])('%s', (text, expected) => {
    expect(extractTimes(text)).toEqual(expected);
  });

  it('accepts a bare hour only when a time was asked', () => {
    expect(extractTimes('18')).toEqual({});
    expect(extractTimes('18', true)).toEqual({ startTime: '18:00' });
  });
});

describe('extractFacts', () => {
  it('takes several facts from one answer (walkthrough)', () => {
    const facts = extractFacts('Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material', {
      now: NOW,
      expecting: 'startTime',
    });
    expect(facts).toEqual({ date: '2026-12-11', startTime: '18:00', places: 8, costs: '5 € Material' });
  });

  it.each([
    ['8 Plätze', 8],
    ['maximal 12 Personen', 12],
    ['für 6 Teilnehmer*innen', 6],
  ])('places: %s', (text, places) => {
    expect(extractFacts(text, { now: NOW }).places).toBe(places);
  });

  it.each([
    ['5 €', '5 €'],
    ['5€', '5 €'],
    ['7,50 Euro', '7,50 €'],
    ['kostenlos', 'kostenlos'],
    ['ist umsonst', 'kostenlos'],
  ])('costs: %s', (text, costs) => {
    expect(extractFacts(text, { now: NOW }).costs).toBe(costs);
  });

  it('fills the asked field from a bare answer', () => {
    expect(extractFacts('8', { now: NOW, expecting: 'places' }).places).toBe(8);
    expect(extractFacts('nein', { now: NOW, expecting: 'costs' }).costs).toBe('kostenlos');
    expect(extractFacts('Lötkurs für Anfänger', { now: NOW, expecting: 'title' }).title).toBe('Lötkurs für Anfänger');
  });

  it('accepts explicit title corrections', () => {
    expect(extractFacts('Titel: Löten lernen', { now: NOW }).title).toBe('Löten lernen');
  });

  it('flags workshops', () => {
    expect(extractFacts('ein Lötkurs', { now: NOW }).isWorkshop).toBe(true);
  });
});

describe('guessTitle / guessType', () => {
  it('finds the title of an event sentence', () => {
    expect(guessTitle('Ich will nächsten Freitag einen Lötkurs für Anfänger machen')).toBe('Lötkurs für Anfänger');
  });

  it('finds the title of a project sentence', () => {
    expect(guessTitle('Ich habe eine Nixie-Uhr gebaut')).toBe('Nixie-Uhr');
  });

  it('guesses the type', () => {
    expect(guessType('Ich habe eine Nixie-Uhr gebaut', NOW)).toBe('projekt');
    expect(guessType('Ich will nächsten Freitag einen Lötkurs machen', NOW)).toBe('event');
    expect(guessType('Hallo', NOW)).toBeUndefined();
  });
});
