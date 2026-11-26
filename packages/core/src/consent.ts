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
  // Doubt always wins, even after a number ("1 Person, nicht gefragt").
  if (
    /nicht gefragt|nicht einverstanden|wei(ß|ss) nicht|keine ahnung|nicht sicher|unsicher/.test(
      t,
    )
  )
    return 'einwilligung_fehlt';
  // A menu number counts alone or followed by (part of) its own label;
  // "3 Leute drauf" is a head count, not answer 3, so it is asked again.
  const menu =
    /^(1️⃣|2️⃣|3️⃣|1|2|3|eins|zwei|drei)(?![\p{L}\d])[\s.,:)!-]*(.*)$/u.exec(t);
  if (menu) {
    const choice =
      (
        { '1️⃣': 1, '2️⃣': 2, '3️⃣': 3, eins: 1, zwei: 2, drei: 3 } as Record<
          string,
          number
        >
      )[menu[1]] ?? Number(menu[1]);
    const rest = menu[2].trim();
    const labels: Record<number, RegExp> = {
      1: /^(ja|alle|einverstanden)/,
      2: /^(ja|aber)/,
      3: /^(nein|keine|niemand)/,
    };
    if (rest && !labels[choice].test(rest)) return null;
    return choice === 2 ? 'einwilligung_fehlt' : 'frei';
  }
  if (/alle (waren )?einverstanden|ja,? alle/.test(t)) return 'frei';
  if (/^(nein|nö|noe|ne|nee|keine|niemand)(?!\p{L})/u.test(t)) return 'frei';
  return null;
}
