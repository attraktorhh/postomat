import { describe, expect, it } from 'vitest';
import { parseConsentAnswer } from '../src/consent.ts';

describe('parseConsentAnswer', () => {
  it.each([
    ['1', 'frei'],
    ['1️⃣', 'frei'],
    ['1️⃣ Ja, alle waren einverstanden', 'frei'],
    ['ja, alle waren einverstanden', 'frei'],
    ['2', 'einwilligung_fehlt'],
    ['2️⃣ Ja, aber nicht gefragt', 'einwilligung_fehlt'],
    ['nicht gefragt', 'einwilligung_fehlt'],
    ['3', 'frei'],
    ['3️⃣ Nein', 'frei'],
    ['nein', 'frei'],
  ])('%s → %s', (answer, expected) => {
    expect(parseConsentAnswer(answer)).toBe(expected);
  });

  it('returns null for unrelated answers', () => {
    expect(parseConsentAnswer('vielleicht')).toBeNull();
  });
});
