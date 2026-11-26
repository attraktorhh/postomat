import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  emptyAiFacts,
  type AiFacts,
  type CandidateChoice,
  type Interpretation,
  type PostFacts,
  type PostType,
} from '@postomat/core';
import { createAiService, type AiService } from '@postomat/ai';
import type { AiTexts } from '@postomat/templates';

/** What the scripted model saw for one interpretation call. */
export interface ScriptedContext {
  erwartet: string | null;
  letzteFrage?: string | null;
  typ?: PostType | null;
  bekannteAngaben?: PostFacts;
  fotoVorhanden?: boolean;
  offeneRueckfrage?: string | null;
  pendingConfirmation?: string | null;
}

export type ScriptedInterpretation = Partial<Omit<Interpretation, 'facts'>> & {
  facts?: Partial<AiFacts>;
};

export interface InterpretRule {
  /** Exact message text, a RegExp, or a predicate (test fixtures only). */
  match: string | RegExp | ((text: string, ctx: ScriptedContext) => boolean);
  result:
    | ScriptedInterpretation
    | ((text: string, ctx: ScriptedContext) => ScriptedInterpretation);
}

export type FailureMode = 'http' | 'timeout' | 'schema';

export interface ScriptedAiOptions {
  /** Rules for `interpret`, first match wins; unmatched messages are `unclear`. */
  rules?: InterpretRule[];
  /** Answer to the Meetup candidate question. Default: "unrelated". */
  candidate?: (
    text: string,
    candidates: Array<{ nummer: number; title: string }>,
  ) => CandidateChoice['choice'];
  /** Channel texts. Default: deterministic texts from the facts. */
  texts?: (input: { typ: PostType; angaben: PostFacts }) => AiTexts;
  /** Timeout of the wrapped AiService (ms). */
  timeoutMs?: number;
}

export interface ScriptedCall {
  kind: 'interpret' | 'candidate' | 'texts' | 'probe';
  /** The raw prompt (system + user) the model received. */
  prompt: string;
  /** The parsed user payload. */
  input: Record<string, unknown>;
}

export interface ScriptedAi extends AiService {
  /** Every model call, in order (for context and privacy assertions). */
  readonly calls: ScriptedCall[];
  /** Messages that went through `interpret`, in order. */
  interpretedTexts(): string[];
  /**
   * Makes the next `times` model calls fail (only calls of `kind`, if given).
   * A schema failure is retried once by the AiService, so it needs 2.
   */
  failNext(
    mode: FailureMode,
    times?: number,
    kind?: ScriptedCall['kind'],
  ): void;
  /** Adds rules in front of the existing ones. */
  addRules(...rules: InterpretRule[]): void;
}

/** Deterministic texts from the facts (used by snapshots and e2e). */
export function scriptedTexts(input: {
  typ: PostType;
  angaben: PostFacts;
}): AiTexts {
  const f = input.angaben;
  const title = f.title ?? 'Ohne Titel';
  const desc = f.description ?? `${title} im Attraktor.`;
  return {
    hookDe:
      input.typ === 'projekt'
        ? `Frisch aus der Werkstatt: ${title}! 🛠️`
        : `Lust auf „${title}“? 🔥`,
    bodyDe:
      input.typ === 'projekt' && f.trickiest
        ? `${desc} Das Kniffligste: ${f.trickiest}`
        : desc,
    titleEn: `${title} (EN)`,
    bodyEn: `Join us at Attraktor: ${title}.`,
    shortEn: `${title} at Attraktor makerspace in Hamburg-Altona.`,
    ...(f.costs ? { costsEn: `${f.costs} (EN)` } : {}),
  };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

const reply = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});

function complete(r: ScriptedInterpretation): Interpretation {
  return {
    intent: r.intent ?? 'provide_info',
    type: r.type ?? null,
    facts: { ...emptyAiFacts(), ...(r.facts ?? {}) },
    consent: r.consent ?? null,
    instruction: r.instruction ?? null,
    text: r.text ?? null,
  };
}

function promptText(prompt: unknown): { system: string; user: string } {
  const msgs = prompt as Array<{
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  }>;
  const text = (role: string) =>
    msgs
      .filter((m) => m.role === role)
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => p.text ?? '').join(''),
      )
      .join('\n');
  return { system: text('system'), user: text('user') };
}

/**
 * A deterministic stand-in for the LLM: the AI SDK mock model behind the real
 * `AiService`, so prompts, schema validation and error handling are the
 * production code. Rules map (message, context) to structured results.
 */
export function createScriptedAi(opts: ScriptedAiOptions = {}): ScriptedAi {
  const rules = [...(opts.rules ?? [])];
  const calls: ScriptedCall[] = [];
  const failures: Array<{ mode: FailureMode; kind?: ScriptedCall['kind'] }> =
    [];

  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const { system, user } = promptText(options.prompt);
      const input = JSON.parse(user) as Record<string, unknown>;
      const kind: ScriptedCall['kind'] = input['probe']
        ? 'probe'
        : system.includes('Meetup-Events')
          ? 'candidate'
          : system.includes('Dialog-Assistent')
            ? 'interpret'
            : 'texts';
      calls.push({ kind, prompt: `${system}\n${user}`, input });

      const i = failures.findIndex((f) => !f.kind || f.kind === kind);
      const failure = i >= 0 ? failures.splice(i, 1)[0].mode : undefined;
      if (failure === 'timeout')
        return new Promise<never>((_, reject) => {
          const signal = options.abortSignal;
          const abort = () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          };
          if (signal?.aborted) abort();
          signal?.addEventListener('abort', abort);
        });
      if (failure === 'http')
        throw new APICallError({
          message: 'Service Unavailable',
          url: 'http://scripted-ai.test/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: false,
        });
      if (failure === 'schema') return reply({ nonsense: true });

      if (kind === 'candidate') {
        const choice =
          opts.candidate?.(
            String(input['antwort']),
            input['kandidaten'] as Array<{ nummer: number; title: string }>,
          ) ?? 'unrelated';
        return reply({ choice });
      }
      if (kind === 'texts') {
        const t = (opts.texts ?? scriptedTexts)(
          input as { typ: PostType; angaben: PostFacts },
        );
        return reply({ costsEn: null, ...t });
      }
      if (kind === 'probe')
        return reply(complete({ intent: 'smalltalk_or_thanks' }));
      const text = String(input['nachricht']);
      const ctx = input['kontext'] as ScriptedContext;
      const rule = rules.find((r) =>
        typeof r.match === 'string'
          ? r.match === text
          : r.match instanceof RegExp
            ? r.match.test(text)
            : r.match(text, ctx),
      );
      const result = rule
        ? typeof rule.result === 'function'
          ? rule.result(text, ctx)
          : rule.result
        : { intent: 'unclear' as const };
      return reply(complete(result));
    },
  });

  const service = createAiService(model, {
    timeoutMs: opts.timeoutMs ?? 500,
    logger: { warn: () => undefined },
  });
  return Object.assign(service, {
    calls,
    interpretedTexts: () =>
      calls
        .filter((c) => c.kind === 'interpret')
        .map((c) => String(c.input['nachricht'])),
    failNext(mode: FailureMode, times = 1, kind?: ScriptedCall['kind']) {
      for (let i = 0; i < times; i++) failures.push({ mode, kind });
    },
    addRules(...more: InterpretRule[]) {
      rules.unshift(...more);
    },
  });
}
