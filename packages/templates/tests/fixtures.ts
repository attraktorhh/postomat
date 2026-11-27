import type { ChannelId } from '@postomat/core';
import { buildDrafts } from '../src/index.ts';
import type { AiTexts, DraftContext, TemplateContext } from '../src/index.ts';

/** Fixed stand-in for the AI-written bodies (deterministic snapshots). */
export function stubTexts(ctx: TemplateContext): AiTexts {
  const f = ctx.facts;
  const title = f.title ?? 'Ohne Titel';
  return {
    hookDe:
      ctx.type === 'projekt'
        ? `Frisch aus der Werkstatt: ${title}! 🛠️`
        : `Lust auf „${title}“? 🔥`,
    bodyDe:
      ctx.type === 'projekt' && f.trickiest
        ? `${f.description ?? title} Das Kniffligste: ${f.trickiest}.`
        : (f.description ?? `${title} im Attraktor.`),
    titleEn: `${title} (EN)`,
    bodyEn: `Join us at Attraktor: ${title}.`,
    shortEn: `${title} at Attraktor makerspace in Hamburg-Altona.`,
    ...(f.costs ? { costsEn: '€5 for material' } : {}),
  };
}

export const withAi = (
  ctx: TemplateContext,
  ai?: Partial<AiTexts>,
): DraftContext => ({
  ...ctx,
  ai: { ...stubTexts(ctx), ...ai },
});

/** buildDrafts with the stub texts (or the context's own `ai` texts). */
export const build = (ctx: TemplateContext, channels: ChannelId[]) =>
  buildDrafts(withAi(ctx, ctx.ai), channels);
