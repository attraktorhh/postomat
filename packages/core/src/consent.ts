import type { ConsentAnswer } from './interpretation.ts';
import type { Consent } from './types.ts';

export const CONSENT_QUESTION =
  'Sind auf dem Foto Personen erkennbar?\n1️⃣ Ja, alle waren einverstanden\n2️⃣ Ja, aber nicht gefragt\n3️⃣ Nein';

export const CONSENT_LABELS: Record<Consent, string> = {
  frei: 'frei verwendbar',
  einwilligung_fehlt: 'Personen – Einwilligung fehlt',
  nur_intern: 'nur intern',
};

/**
 * Maps the (AI-classified) answer to the consent question to the photo state:
 * 1 → frei (everybody agreed), 2 → einwilligung_fehlt, 3 → frei (no people).
 */
export const CONSENT_FROM_ANSWER: Record<ConsentAnswer, Consent> = {
  alle_einverstanden: 'frei',
  nicht_gefragt: 'einwilligung_fehlt',
  keine_personen: 'frei',
};

/** Echo of the understood consent answer, so a misreading is visible at once. */
export const CONSENT_ECHO: Record<ConsentAnswer, string> = {
  alle_einverstanden: 'Alles klar: Personen drauf, alle waren einverstanden.',
  nicht_gefragt:
    'Alles klar: Personen drauf, aber nicht gefragt. Das Medienteam klärt das vor der Veröffentlichung.',
  keine_personen: 'Alles klar: keine Personen erkennbar.',
};
