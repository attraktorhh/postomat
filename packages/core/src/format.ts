import type { PostFacts, PostType } from './types.ts';
import { dayMonthDe, shortWeekdayDateDe, weekdayDe } from './time.ts';

export const TYPE_LABELS: Record<PostType, string> = { event: 'Event', projekt: 'Projekt' };

/** "Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material" (DM confirmation). */
export function factsLineDm(f: PostFacts): string {
  const parts: string[] = [];
  if (f.date) parts.push(`${weekdayDe(f.date)} ${dayMonthDe(f.date)}`);
  if (f.startTime) parts.push(f.endTime ? `${f.startTime}–${f.endTime}` : f.startTime);
  if (f.places !== undefined) parts.push(`${f.places} Plätze`);
  if (f.costs) parts.push(f.costs);
  return parts.join(' · ');
}

/** "Event · Fr 11.12. · 18:00 · 8 Plätze · 5 €" (card, web header). */
export function factsLineShort(type: PostType, f: PostFacts): string {
  const parts: string[] = [TYPE_LABELS[type]];
  if (f.date) parts.push(shortWeekdayDateDe(f.date));
  if (f.startTime) parts.push(f.startTime);
  if (f.places !== undefined) parts.push(`${f.places} Plätze`);
  if (f.costs) parts.push(f.costs.replace(/ Material$/, ''));
  return parts.join(' · ');
}
