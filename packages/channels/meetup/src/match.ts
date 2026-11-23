import { berlinToInstant, localDateOf } from '@postomat/core';
import type { FeedEvent } from './ical.ts';

/** Lowercase, strip emoji/punctuation, keep the German part before " / ". */
export function normalizeTitle(title: string): string {
  const de = title.split(' / ')[0] ?? title;
  return de
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, ' ');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice<T>(a: T[], b: T[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const counts = new Map<T, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      inter++;
      counts.set(x, n - 1);
    }
  }
  return (2 * inter) / (a.length + b.length);
}

/** Title similarity 0..1: max of character-bigram Dice and token Dice. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return Math.max(dice(bigrams(na), bigrams(nb)), dice(na.split(' '), nb.split(' ')));
}

export const STRONG_THRESHOLD = 0.6;
export const WEAK_THRESHOLD = 0.3;
export const START_TOLERANCE_MIN = 60;

export interface MatchCandidate {
  event: FeedEvent;
  similarity: number;
  timeOk: boolean;
}

export type MatchResult =
  | { kind: 'strong'; event: FeedEvent; similarity: number }
  | { kind: 'ambiguous'; candidates: MatchCandidate[] }
  | { kind: 'none' };

export interface MatchablePost {
  title: string;
  /** Local date YYYY-MM-DD */
  date: string;
  /** Local start HH:MM */
  startTime: string;
}

/**
 * Finds the Meetup event for a post: same local date (Europe/Berlin), start
 * within ±60 min and title similarity ≥ 0.6 is a strong match. Weaker
 * same-day candidates (0.3–0.6) or several strong matches are ambiguous.
 * Events already linked to another post are ignored.
 */
export function matchMeetupEvent(post: MatchablePost, events: FeedEvent[], linkedIds: ReadonlySet<string>): MatchResult {
  const start = berlinToInstant(post.date, post.startTime).getTime();
  const sameDay = events
    .filter((e) => !linkedIds.has(e.meetupId) && !linkedIds.has(e.uid))
    .filter((e) => localDateOf(e.start) === post.date)
    .map<MatchCandidate>((event) => ({
      event,
      similarity: titleSimilarity(post.title, event.summary),
      timeOk: Math.abs(event.start.getTime() - start) <= START_TOLERANCE_MIN * 60000,
    }));
  const strong = sameDay.filter((c) => c.timeOk && c.similarity >= STRONG_THRESHOLD);
  if (strong.length === 1) return { kind: 'strong', event: strong[0].event, similarity: strong[0].similarity };
  const weak = sameDay.filter((c) => c.similarity >= WEAK_THRESHOLD);
  if (strong.length > 1 || weak.length) {
    const candidates = (strong.length > 1 ? strong : weak).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    return { kind: 'ambiguous', candidates };
  }
  return { kind: 'none' };
}
