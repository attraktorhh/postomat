import { generateText, Output, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import {
  localDateOf,
  weekdayDe,
  type AiExtraction,
  type Env,
  type PostFacts,
  type PostType,
} from '@postomat/core';
import type { AiTexts } from '@postomat/templates';

export interface AiLogger {
  warn(msg: string, data?: Record<string, unknown>): void;
}

/** What Postomat asks an LLM. Every method returns null on error/timeout (never throws). */
export interface AiService {
  /** Detects post type and facts in a member message. */
  extract(input: {
    text: string;
    type?: PostType;
    facts: PostFacts;
    now: Date;
  }): Promise<AiExtraction | null>;
  /** Writes channel body texts (DE + EN) following the style guide. */
  writeTexts(input: {
    type: PostType;
    facts: PostFacts;
    instruction?: string;
    previous?: AiTexts;
  }): Promise<AiTexts | null>;
}

const extractionSchema = z.object({
  type: z
    .enum(['event', 'projekt'])
    .nullable()
    .describe(
      'event = upcoming date at the makerspace; projekt = something a member built',
    ),
  title: z
    .string()
    .nullable()
    .describe('Short German title, e.g. "Lötkurs für Anfänger"'),
  description: z
    .string()
    .nullable()
    .describe('1–2 German sentences describing it, written with "du"'),
  date: z
    .string()
    .nullable()
    .describe('Local date YYYY-MM-DD (Europe/Berlin) or null'),
  startTime: z.string().nullable().describe('HH:MM or null'),
  endTime: z.string().nullable().describe('HH:MM or null'),
  places: z.number().int().nullable(),
  costs: z.string().nullable().describe('e.g. "5 € Material" or "kostenlos"'),
  audience: z.string().nullable(),
  trickiest: z.string().nullable().describe('Projekt: the trickiest part'),
  isWorkshop: z.boolean().nullable(),
});

const textsSchema = z.object({
  hookDe: z
    .string()
    .describe(
      'Instagram hook in German: a question or exclamation, with one emoji',
    ),
  bodyDe: z
    .string()
    .describe('2–3 short German sentences, address readers with "du"/"ihr"'),
  titleEn: z.string().describe('English title'),
  bodyEn: z.string().describe('2–3 short English sentences'),
  shortEn: z
    .string()
    .describe('One English sentence summary incl. date/time if any'),
});

const STYLE = `Du schreibst für den Attraktor e.V., einen Makerspace in Hamburg-Altona.
Regeln: Leser immer mit "du"/"ihr" ansprechen. Kurz, freundlich, konkret. Keine erfundenen Fakten:
nutze nur die gegebenen Angaben. Keine Personennamen. Englische Texte sind natürliche Kurzfassungen.`;

const clean = <T extends Record<string, unknown>>(
  o: T,
): Partial<{ [K in keyof T]: NonNullable<T[K]> }> =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    ),
  ) as never;

export function createAiService(
  model: LanguageModel,
  opts: { timeoutMs: number; logger?: AiLogger },
): AiService {
  const log = opts.logger ?? { warn: (m, d) => console.warn(m, d ?? '') };

  async function run<T>(
    what: string,
    schema: z.ZodType<T>,
    system: string,
    prompt: string,
  ): Promise<T | null> {
    try {
      const res = await generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema }),
        abortSignal: AbortSignal.timeout(opts.timeoutMs),
        maxRetries: 1,
      });
      return res.output as T;
    } catch (e) {
      log.warn(`AI ${what} failed, falling back to templates`, {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  return {
    async extract({ text, type, facts, now }) {
      const today = localDateOf(now);
      // Only the message and already known facts are sent – no Matrix IDs, no names.
      const r = await run(
        'extract',
        extractionSchema,
        `${STYLE}\nExtrahiere Angaben aus Nachrichten von Mitgliedern. Heute ist ${weekdayDe(today)}, ${today} (Europe/Berlin). Relative Angaben wie "nächsten Freitag" beziehen sich auf heute. Unbekanntes = null.`,
        JSON.stringify({
          bekannterTyp: type ?? null,
          bekannteAngaben: facts,
          nachricht: text,
        }),
      );
      if (!r) return null;
      const { type: t, ...rest } = r;
      return { type: t ?? undefined, facts: clean(rest) as PostFacts };
    },
    async writeTexts({ type, facts, instruction, previous }) {
      const r = await run(
        'texts',
        textsSchema,
        `${STYLE}\nSchreibe Texte für Instagram, Website und Meetup nach dem Attraktor-Stil.`,
        JSON.stringify({
          typ: type,
          angaben: facts,
          vorherigeTexte: previous ?? null,
          aenderungswunsch: instruction ?? null,
        }),
      );
      return r ? (clean(r) as AiTexts) : null;
    },
  };
}

/** Builds the AI service from env, or null when AI_PROVIDER=none or incomplete. */
export function createAiFromEnv(env: Env, logger?: AiLogger): AiService | null {
  if (env.AI_PROVIDER === 'none') return null;
  if (!env.AI_BASE_URL || !env.AI_MODEL) {
    logger?.warn(
      'AI_PROVIDER is set but AI_BASE_URL/AI_MODEL are missing – running without AI',
    );
    return null;
  }
  const provider = createOpenAICompatible({
    name: 'postomat-llm',
    baseURL: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
  });
  return createAiService(provider.chatModel(env.AI_MODEL), {
    timeoutMs: env.AI_TIMEOUT_MS,
    logger,
  });
}
