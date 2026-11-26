import {
  addMinutesToTime,
  type PostFacts,
  type PostomatConfig,
  type PostType,
} from '@postomat/core';

/** AI-written bodies (`AiService.writeTexts`). Drafts are never built without them. */
export interface AiTexts {
  /** Instagram hook (question or exclamation), German. */
  hookDe: string;
  /** 2–3 short German sentences. */
  bodyDe: string;
  /** English title. */
  titleEn: string;
  /** 2–3 short English sentences. */
  bodyEn: string;
  /** One-sentence English short version for Instagram/Facebook. */
  shortEn: string;
  /** The cost note in English ("€5 for material", "free"). */
  costsEn?: string;
}

export interface TemplateContext {
  type: PostType;
  facts: PostFacts;
  config: PostomatConfig;
  /** Used for the time range when no end time is set. */
  defaultDurationMin: number;
  /** Required for `buildDrafts`; publishing works from the stored drafts. */
  ai?: AiTexts;
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

export const title = (ctx: TemplateContext): string =>
  ctx.facts.title?.trim() || 'Ohne Titel';

export function hashtags(ctx: TemplateContext): string {
  const h = ctx.config.hashtags;
  const tags = [
    ...h.base,
    ...(ctx.type === 'event' ? h.event : h.projekt),
    ...(ctx.facts.isWorkshop ? h.workshop : []),
  ];
  return Array.from(new Set(tags)).slice(0, 8).join(' ');
}
