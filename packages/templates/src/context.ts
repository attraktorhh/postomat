import {
  addMinutesToTime,
  type PostFacts,
  type PostomatConfig,
  type PostType,
} from '@postomat/core';

/** Optional AI-written bodies. Templates use them when present. */
export interface AiTexts {
  /** Instagram hook (question or exclamation), German. */
  hookDe?: string;
  /** 2–3 short German sentences. */
  bodyDe?: string;
  /** English title. */
  titleEn?: string;
  /** 2–3 short English sentences. */
  bodyEn?: string;
  /** One-sentence English short version for Instagram/Facebook. */
  shortEn?: string;
}

export interface TemplateContext {
  type: PostType;
  facts: PostFacts;
  config: PostomatConfig;
  /** Used for the time range when no end time is set. */
  defaultDurationMin: number;
  ai?: AiTexts | null;
}

export interface Links {
  meetup?: string | null;
  website?: string | null;
  wiki?: string | null;
}

/** End time or start + default duration. */
export function effectiveEnd(ctx: TemplateContext): string | undefined {
  const { startTime, endTime } = ctx.facts;
  if (endTime) return endTime;
  if (!startTime) return undefined;
  return addMinutesToTime(startTime, ctx.defaultDurationMin);
}

export const title = (ctx: TemplateContext): string => ctx.facts.title?.trim() || 'Ohne Titel';

/** "5 € Material" → "€5 for material", "kostenlos" → "free". */
export function costsEn(costs?: string): string | undefined {
  if (!costs) return undefined;
  if (/kostenlos|umsonst|gratis/i.test(costs)) return 'free';
  const amount = /(\d+(?:,\d{1,2})?)/.exec(costs)?.[1]?.replace(',', '.');
  if (!amount) return costs;
  return `€${amount}${/material/i.test(costs) ? ' for material' : ''}`;
}

export function hashtags(ctx: TemplateContext): string {
  const h = ctx.config.hashtags;
  const tags = [
    ...h.base,
    ...(ctx.type === 'event' ? h.event : h.projekt),
    ...(ctx.facts.isWorkshop ? h.workshop : []),
  ];
  return Array.from(new Set(tags)).slice(0, 8).join(' ');
}

export const firstSentences = (text: string | undefined, max = 3): string =>
  (text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, max)
    .join(' ')
    .trim();
