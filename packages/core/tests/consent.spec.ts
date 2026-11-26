import { describe, expect, it } from 'vitest';
import { parseConsentAnswer } from '../src/consent.ts';

describe('parseConsentAnswer', () => {
  it.each([
    ['1', 'frei'],
    ['1️⃣', 'frei'],
    ['1.', 'frei'],
    ['1️⃣ Ja, alle waren einverstanden', 'frei'],
    ['ja, alle waren einverstanden', 'frei'],
    ['2', 'einwilligung_fehlt'],
    ['2️⃣ Ja, aber nicht gefragt', 'einwilligung_fehlt'],
    ['nicht gefragt', 'einwilligung_fehlt'],
    ['3', 'frei'],
    ['3️⃣ Nein', 'frei'],
    ['drei', 'frei'],
    ['nein', 'frei'],
    ['nö', 'frei'],
    ['Nö, nur Lötkolben', 'frei'],
    ['nee', 'frei'],
    ['keine Personen drauf', 'frei'],
    ['nein, keine Personen', 'frei'],
  ])('%s → %s', (answer, expected) => {
    expect(parseConsentAnswer(answer)).toBe(expected);
  });

  it.each([
    ['keine Ahnung'],
    ['weiß nicht'],
    ['1 Person, nicht gefragt'],
    ['3 Leute drauf, nicht gefragt'],
    ['Nein, ich habe nicht gefragt'],
    ['nein, keiner hat zugestimmt'],
  ])('doubt wins: %s → einwilligung_fehlt', (answer) => {
    expect(parseConsentAnswer(answer)).toBe('einwilligung_fehlt');
  });

  it.each([
    ['vielleicht'],
    ['3 Leute drauf'],
    ['1 Person'],
    ['nein, nur Kai hat mitgemacht'],
    ['nein danke'],
  ])('asks again for unclear answers: %s', (answer) => {
    expect(parseConsentAnswer(answer)).toBeNull();
  });
});
