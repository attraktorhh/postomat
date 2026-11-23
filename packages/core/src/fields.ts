import type { FactKey, PostFacts, PostType } from './types.ts';

export const FIELD_LABELS: Record<FactKey, string> = {
  title: 'Titel',
  description: 'Beschreibung',
  date: 'Datum',
  startTime: 'Uhrzeit',
  endTime: 'Ende',
  places: 'Plätze',
  costs: 'Kosten',
  audience: 'Zielgruppe',
  location: 'Ort',
  trickiest: 'Das Kniffligste',
  isWorkshop: 'Workshop',
};

export const REQUIRED_FIELDS: Record<PostType, FactKey[]> = {
  event: ['title', 'date', 'startTime', 'description'],
  projekt: ['title', 'description', 'trickiest'],
};

/** Whether a photo is required for this post type. */
export const PHOTO_REQUIRED: Record<PostType, boolean> = {
  event: false,
  projekt: true,
};

export function missingRequiredFields(
  type: PostType,
  facts: PostFacts,
  photoCount: number,
): string[] {
  const missing = REQUIRED_FIELDS[type]
    .filter((k) => facts[k] === undefined || facts[k] === '')
    .map((k) => FIELD_LABELS[k]);
  if (PHOTO_REQUIRED[type] && photoCount === 0) missing.push('Foto');
  return missing;
}
