import type { Consent } from './types.ts';

export const CONSENT_QUESTION =
  'Danke! Sind auf dem Foto Personen erkennbar?\n1️⃣ Ja, alle waren einverstanden\n2️⃣ Ja, aber nicht gefragt\n3️⃣ Nein';

export const CONSENT_LABELS: Record<Consent, string> = {
  frei: 'frei verwendbar',
  einwilligung_fehlt: 'Personen – Einwilligung fehlt',
  nur_intern: 'nur intern',
};

/**
 * Maps the member's answer to the consent question:
 * 1 → frei (everybody agreed), 2 → einwilligung_fehlt, 3 → frei (no people).
 * Returns null when the answer is not recognisable.
 */
export function parseConsentAnswer(text: string): Consent | null {
  const t = text.trim().toLowerCase();
  if (/^(1|1️⃣|eins)\b/u.test(t) || t.startsWith('1️⃣')) return 'frei';
  if (/^(2|2️⃣|zwei)\b/u.test(t) || t.startsWith('2️⃣'))
    return 'einwilligung_fehlt';
  if (/^(3|3️⃣|drei)\b/u.test(t) || t.startsWith('3️⃣')) return 'frei';
  if (/nicht gefragt|nicht einverstanden|weiß nicht|weiss nicht/.test(t))
    return 'einwilligung_fehlt';
  if (/alle (waren )?einverstanden|ja,? alle/.test(t)) return 'frei';
  if (/^(nein|nö|ne|nee|keine)\b/.test(t)) return 'frei';
  return null;
}
