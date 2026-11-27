import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  extractJsonMiddleware,
  Output,
  RetryError,
  TypeValidationError,
  JSONParseError,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  injectJsonInstructionIntoMessages,
  isAbortError,
} from '@ai-sdk/provider-utils';
import pRetry from 'p-retry';
import { z } from 'zod';
import {
  addDays,
  candidateSchema,
  interpretationSchema,
  localDateOf,
  localTimeOf,
  TIMEZONE,
  weekdayDe,
  type CandidateChoice,
  type Env,
  type InterpretContext,
  type Interpretation,
  type PostFacts,
  type PostType,
} from '@postomat/core';
import type { AiTexts } from '@postomat/templates';

export interface AiLogger {
  warn(msg: string, data?: Record<string, unknown>): void;
}

export type AiErrorKind = 'config' | 'timeout' | 'http' | 'schema' | 'refusal';

/**
 * Typed AI failure. There is no fallback: callers tell the person to try
 * again (DM, thread) or let the job retry (worker).
 */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  /** HTTP status of the provider response, if any. */
  readonly status?: number;
  constructor(
    kind: AiErrorKind,
    message: string,
    options?: ErrorOptions & { status?: number },
  ) {
    super(message, options);
    this.name = 'AiError';
    this.kind = kind;
    this.status = options?.status;
  }
}

export const isAiError = (e: unknown): e is AiError =>
  e instanceof AiError ||
  (e instanceof Error && e.name === 'AiError' && 'kind' in e);

export interface AiStatus {
  lastError: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export interface InterpretInput {
  text: string;
  context: InterpretContext;
  now: Date;
}

export interface CandidateInput {
  text: string;
  /** Only titles, dates and times – no IDs, no names. */
  candidates: Array<{ title: string; date: string; time: string }>;
}

export interface WriteTextsInput {
  type: PostType;
  facts: PostFacts;
  instruction?: string;
  previous?: AiTexts;
}

/**
 * What Postomat asks an LLM. Every method either returns a schema-validated
 * result or throws an `AiError`; it never returns null.
 */
export interface AiService {
  /** Interprets one chat message from a member (intent + facts). */
  interpret(input: InterpretInput): Promise<Interpretation>;
  /** Interprets the Medienteam's reply to the Meetup candidate question. */
  interpretCandidateReply(input: CandidateInput): Promise<CandidateChoice>;
  /** Writes the free channel body texts (DE + EN) following the style guide. */
  writeTexts(input: WriteTextsInput): Promise<AiTexts>;
  /** One tiny structured call; throws when the endpoint is not usable. */
  probe(): Promise<void>;
  status(): AiStatus;
}

// ---------------------------------------------------------------- schemas
// Interpretation and candidate schemas live in @postomat/core (the contract
// shared with the dialog). Texts: limits keep a runaway answer out of the
// drafts.

const textsSchema = z.object({
  hookDe: z
    .string()
    .max(300)
    .describe(
      'Instagram-Hook auf Deutsch: eine Frage oder ein Ausruf, mit einem Emoji',
    ),
  bodyDe: z
    .string()
    .max(2000)
    .describe('2–3 kurze deutsche Sätze, Leser mit "du"/"ihr" ansprechen'),
  titleEn: z.string().max(200).describe('English title'),
  bodyEn: z.string().max(2000).describe('2–3 short English sentences'),
  shortEn: z
    .string()
    .max(500)
    .describe('One English sentence summary incl. date/time if any'),
  costsEn: z
    .string()
    .max(200)
    .nullable()
    .describe('The cost note in English, e.g. "€5 for material" or "free"'),
});

// ---------------------------------------------------------------- prompts

const STYLE = `Du schreibst für den Attraktor e.V., einen Makerspace in Hamburg-Altona.
Regeln: Leser immer mit "du"/"ihr" ansprechen. Kurz, freundlich, konkret. Keine erfundenen Fakten:
nutze nur die gegebenen Angaben. Keine Personennamen. Englische Texte sind natürliche Kurzfassungen.`;

const INTERPRET_RULES = `Du bist der Dialog-Assistent von Postomat. Ein Mitglied des Attraktor e.V. (Makerspace in Hamburg) schreibt dir im Chat, um ein Event (einen Termin im Attraktor) oder ein Projekt (etwas, das es gebaut hat) für Website, Wiki, Meetup und Social Media einzureichen.
Deine Aufgabe: genau EINE Nachricht verstehen und strukturiert zurückgeben. Du antwortest dem Mitglied nicht selbst.

Intents:
- provide_info: Die Nachricht nennt oder korrigiert Angaben (auch als Antwort auf die gestellte Frage).
- choose_type: Wählt Event (1, 1️⃣, "Event", "ein Workshop", "Termin") oder Projekt (2, 2️⃣, "hab was gebaut"); setze type.
- answer_consent: Antwort auf die Foto-Einwilligungsfrage; setze consent:
  alle_einverstanden = 1 / 1️⃣ / Personen drauf und alle haben zugestimmt;
  nicht_gefragt = 2 / 2️⃣ / Personen drauf, aber nicht gefragt oder unklar;
  keine_personen = 3 / 3️⃣ / keine Personen erkennbar.
  Ist die Antwort mehrdeutig, nutze intent unclear.
- decline_photo: Hat kein Foto oder will keins schicken ("nö", "hab keins", "ohne Foto").
- skip_optional: Will die gestellte (optionale) Frage überspringen ("weiter", "-", "egal", "weiß ich noch nicht").
- confirm_submit: Will die gezeigte Zusammenfassung ans Medienteam schicken ("abschicken", "passt, schick's ab"; "ja" nur, wenn erwartet = submit).
- confirm_yes / confirm_no: Ja/Nein auf eine offene Bestätigungsfrage (pendingConfirmation) oder eine Ja/Nein-Frage. Ist eine Bestätigungsfrage offen, ist jede Zustimmung confirm_yes ("jo", "weg damit", "klar, lösch es").
- request_text_change: Will nur die Formulierung der Texte geändert haben (Ton, Länge, etwas erwähnen); instruction = was geändert werden soll. Ändert die Nachricht eine Angabe (Titel, Datum, Uhrzeit, Plätze, Kosten, Zielgruppe, Beschreibung), ist das provide_info mit den neuen facts.
- note_for_team: Ein Hinweis fürs Medienteam, der keine Angabe ist; text = der Hinweis.
- answer_rueckfrage: Antwort auf die offene Rückfrage des Medienteams (openRueckfrage). Enthält sie Angaben, trage sie zusätzlich in facts ein.
- smalltalk_or_thanks: Begrüßung, Dank, Smalltalk.
- cmd_help (Hilfe), cmd_status (eigene Beiträge/Status), cmd_new (neuen Beitrag beginnen), cmd_cancel (Entwurf verwerfen/abbrechen) – in jeder Formulierung.
- retry: Will etwas, das eben nicht geklappt hat, noch einmal versuchen ("nochmal").
- unclear: Nichts davon passt sicher.

Angaben (facts): Fülle nur Felder, die DIESE Nachricht nennt oder korrigiert, alle anderen = null. Erfinde nichts.
- Relative Angaben ("nächsten Freitag", "den Freitag danach", "morgen") rechnest du vom angegebenen Jetzt und den bekannten Angaben aus. "Den Freitag danach" = eine Woche nach dem bekannten Datum.
- Uhrzeiten als HH:MM ("18 Uhr" → 18:00, "18–21 Uhr" → startTime 18:00, endTime 21:00).
- costs kurz auf Deutsch: "5 € fürs Material" → "5 € Material"; "umsonst"/"gratis"/"nein" auf die Kostenfrage → "kostenlos".
- places: "max. 8 Leute" → 8.
- title: kurzer Titel ohne Datum. description: 1–2 Sätze mit "du" – nur, wenn die Nachricht beschreibt, worum es geht, oder die Beschreibungsfrage beantwortet.
- Antwortet die Nachricht direkt auf die gestellte Frage (expecting), ordne sie diesem Feld zu.
type: "event" oder "projekt", wenn die Nachricht es erkennen lässt, sonst null.
Nutze instruction und text nur für die genannten Intents, sonst null.`;

const CANDIDATE_RULES = `Das Medienteam wurde gefragt, welches von mehreren Meetup-Events zu einem Beitrag gehört ("antworte mit der Zahl oder „nein“").
Lies die Antwort und gib zurück:
- choice = Nummer (1-basiert) des gemeinten Events ("2", "2️⃣", "das zweite", "das mit Löten");
- choice = "none", wenn keins passt ("nein", "keins davon");
- choice = "unrelated", wenn die Antwort nichts mit der Frage zu tun hat (z. B. ein Änderungswunsch zum Beitrag).`;

function nowLine(now: Date): string {
  const date = localDateOf(now);
  // A small calendar, so the model looks dates up instead of computing them.
  const days = Array.from({ length: 21 }, (_, i) => {
    const d = addDays(date, i);
    return `${weekdayDe(d)} ${d}`;
  });
  return `Jetzt: ${weekdayDe(date)}, ${date}, ${localTimeOf(now)} Uhr (Zeitzone ${TIMEZONE}).
Kalender ab heute: ${days.join(', ')}.
Datumsangaben immer als YYYY-MM-DD, Uhrzeiten immer als HH:MM.`;
}

// ---------------------------------------------------------------- errors

/** Maps AI SDK errors to the typed `AiError` kinds. */
function classify(e: unknown): AiError {
  if (isAiError(e)) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  const inner =
    RetryError.isInstance(e) && e.lastError instanceof Error
      ? e.lastError
      : err;
  if (inner.name === 'TimeoutError' || isAbortError(inner as unknown))
    return new AiError('timeout', 'AI request timed out', { cause: e });
  if (
    NoObjectGeneratedError.isInstance(inner) ||
    NoOutputGeneratedError.isInstance(inner) ||
    TypeValidationError.isInstance(inner) ||
    JSONParseError.isInstance(inner)
  )
    return new AiError('schema', 'AI output did not match the schema', {
      cause: e,
    });
  if (APICallError.isInstance(inner))
    return new AiError(
      'http',
      `AI endpoint returned ${inner.statusCode ?? 'an error'}`,
      { cause: e, status: inner.statusCode },
    );
  return new AiError('http', `AI request failed: ${inner.message}`, {
    cause: e,
  });
}

// ---------------------------------------------------------------- service

/** Names of the structured outputs (sent to the provider as schema name). */
export type OutputName = 'interpretation' | 'candidate' | 'texts';

/**
 * Upper bound for one answer. The texts are the longest (~5000 chars, ~1500
 * tokens); the rest is headroom for reasoning tokens, which count too.
 */
const MAX_OUTPUT_TOKENS = 8192;

/** A schema re-try needs at least this much of the deadline left (ms). */
const MIN_RETRY_MS = 1000;

export function createAiService(
  model: LanguageModel,
  opts: {
    timeoutMs: number;
    /** AI SDK reasoning level; undefined = provider default. */
    reasoning?: Env['AI_REASONING'];
    logger?: AiLogger;
  },
): AiService {
  const log = opts.logger ?? { warn: (m, d) => console.warn(m, d ?? '') };
  const status: AiStatus = {
    lastError: null,
    lastErrorAt: null,
    lastOkAt: null,
  };

  async function run<T>(
    what: string,
    output: { name: OutputName; schema: z.ZodType<T> },
    system: string,
    prompt: string,
    runOpts: { schemaRetry?: boolean } = {},
  ): Promise<T> {
    // The AI SDK validates the output against the schema (NoObjectGeneratedError
    // otherwise), retries retryable HTTP errors and enforces the timeout. Both
    // tries share one deadline, so a call never takes much more than timeoutMs.
    const deadline = Date.now() + opts.timeoutMs;
    const once = async (): Promise<T> => {
      const res = await generateText({
        model,
        system,
        prompt,
        // The name lets providers (and the test doubles) tell the calls apart.
        output: Output.object(output),
        timeout: Math.max(deadline - Date.now(), 1),
        maxRetries: 1,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
      });
      if (res.finishReason === 'content-filter')
        throw new AiError('refusal', 'AI provider refused the request');
      return res.output as T;
    };
    try {
      let result: T;
      try {
        result = await once();
      } catch (e) {
        // The SDK does not retry invalid output: one more try on a schema miss,
        // if there is time left.
        if (
          runOpts.schemaRetry === false ||
          classify(e).kind !== 'schema' ||
          deadline - Date.now() < Math.min(MIN_RETRY_MS, opts.timeoutMs / 4)
        )
          throw e;
        result = await once();
      }
      status.lastOkAt = new Date().toISOString();
      return result;
    } catch (e) {
      const err = classify(e);
      status.lastError = `${what}: ${err.kind}`;
      status.lastErrorAt = new Date().toISOString();
      // Never log the message content.
      log.warn(`AI ${what} failed`, { kind: err.kind, error: err.message });
      throw err;
    }
  }

  return {
    async interpret({ text, context, now }) {
      // Only the message, known facts and dialog context – no Matrix IDs, no names.
      return run(
        'interpret',
        { name: 'interpretation', schema: interpretationSchema },
        `${INTERPRET_RULES}\n${nowLine(now)}`,
        JSON.stringify({
          kontext: {
            erwartet: context.expecting,
            letzteFrage: context.question ?? null,
            typ: context.type,
            bekannteAngaben: context.facts,
            fotoVorhanden: context.hasPhoto,
            offeneRueckfrage: context.openRueckfrage,
            pendingConfirmation: context.pendingConfirmation,
          },
          nachricht: text,
        }),
      );
    },
    async interpretCandidateReply({ text, candidates }) {
      const r = await run(
        'candidate',
        { name: 'candidate', schema: candidateSchema },
        CANDIDATE_RULES,
        JSON.stringify({
          kandidaten: candidates.map((c, i) => ({ nummer: i + 1, ...c })),
          antwort: text,
        }),
      );
      if (typeof r.choice === 'number') {
        // Out-of-range numbers are not a valid pick.
        if (r.choice < 1 || r.choice > candidates.length)
          return { choice: 'unrelated' };
        return { choice: r.choice };
      }
      return { choice: r.choice };
    },
    async writeTexts({ type, facts, instruction, previous }) {
      const r = await run(
        'texts',
        { name: 'texts', schema: textsSchema },
        `${STYLE}\nSchreibe Texte für Instagram, Website und Meetup nach dem Attraktor-Stil.`,
        JSON.stringify({
          typ: type,
          angaben: facts,
          vorherigeTexte: previous ?? null,
          aenderungswunsch: instruction ?? null,
        }),
      );
      const t = (v: string | null) => v?.trim() ?? '';
      const texts: AiTexts = {
        hookDe: t(r.hookDe),
        bodyDe: t(r.bodyDe),
        titleEn: t(r.titleEn),
        bodyEn: t(r.bodyEn),
        shortEn: t(r.shortEn),
        ...(t(r.costsEn) ? { costsEn: t(r.costsEn) } : {}),
      };
      if (!texts.hookDe || !texts.bodyDe || !texts.bodyEn || !texts.titleEn)
        throw new AiError('schema', 'AI returned empty texts');
      if (!texts.shortEn) texts.shortEn = texts.bodyEn;
      return texts;
    },
    async probe() {
      await run(
        'probe',
        { name: 'interpretation', schema: interpretationSchema },
        `${INTERPRET_RULES}\n${nowLine(new Date())}`,
        JSON.stringify({
          probe: true,
          kontext: { erwartet: null, bekannteAngaben: {} },
          nachricht: 'Hallo',
        }),
        // waitForAi retries the whole probe; no extra request per attempt.
        { schemaRetry: false },
      );
    },
    status: () => ({ ...status }),
  };
}

/** Throws an `AiError('config')` naming the missing variables. */
export function requireAiConfig(env: Env): {
  provider: Env['AI_PROVIDER'];
  model: string;
} {
  const missing = [
    env.AI_PROVIDER === 'openai-compatible' &&
      !env.AI_BASE_URL &&
      'AI_BASE_URL',
    !env.AI_MODEL && 'AI_MODEL',
    env.AI_PROVIDER !== 'openai-compatible' && !env.AI_API_KEY && 'AI_API_KEY',
  ].filter(Boolean);
  if (missing.length)
    throw new AiError(
      'config',
      `AI configuration missing: ${missing.join(', ')} (AI_PROVIDER=${env.AI_PROVIDER}, see .env.example).`,
    );
  return { provider: env.AI_PROVIDER, model: env.AI_MODEL! };
}

/**
 * JSON mode for OpenAI-compatible endpoints without `json_schema`: the
 * provider sends `response_format: json_object`, so the schema goes into the
 * prompt (the AI SDK helper the provider packages use for the same case).
 */
const jsonModeMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) =>
    params.responseFormat?.type === 'json'
      ? {
          ...params,
          prompt: injectJsonInstructionIntoMessages({
            messages: params.prompt,
            schema: params.responseFormat.schema,
          }),
        }
      : params,
};

/**
 * The AI SDK language model for `AI_PROVIDER`. `fetch` is for tests (records
 * the HTTP requests the provider package sends).
 */
export function languageModelFromEnv(
  env: Env,
  opts: { fetch?: typeof globalThis.fetch } = {},
): LanguageModel {
  const { provider, model } = requireAiConfig(env);
  const common = {
    apiKey: env.AI_API_KEY,
    baseURL: env.AI_BASE_URL,
    fetch: opts.fetch,
  };
  switch (provider) {
    case 'openai':
      return createOpenAI(common)(model);
    case 'anthropic':
      return createAnthropic(common)(model);
    case 'deepseek':
      // JSON mode with the schema in the prompt (DeepSeek has no json_schema).
      return createDeepSeek(common)(model);
    case 'openai-compatible': {
      const jsonSchema = env.AI_STRUCTURED_OUTPUT === 'json_schema';
      const chat = createOpenAICompatible({
        name: 'postomat-llm',
        baseURL: env.AI_BASE_URL!,
        apiKey: env.AI_API_KEY,
        fetch: opts.fetch,
        supportsStructuredOutputs: jsonSchema,
      }).chatModel(model);
      // Local models often wrap JSON in a ```json fence: strip it (both modes).
      return wrapLanguageModel({
        model: chat,
        middleware: jsonSchema
          ? [extractJsonMiddleware()]
          : [jsonModeMiddleware, extractJsonMiddleware()],
      });
    }
  }
}

/** Builds the AI service from env. Never returns null: throws on missing config. */
export function createAiFromEnv(
  env: Env,
  logger?: AiLogger,
  opts: { fetch?: typeof globalThis.fetch } = {},
): AiService {
  const log = logger ?? { warn: (m, d) => console.warn(m, d ?? '') };
  // AI SDK warnings go to our logger. The JSON-mode ones are the configured
  // behaviour (schema in the prompt), not a problem.
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    for (const w of warnings) {
      if ('feature' in w && String(w.feature).startsWith('responseFormat'))
        continue;
      log.warn('AI SDK warning', { provider, model, warning: w });
    }
  };
  return createAiService(languageModelFromEnv(env, opts), {
    timeoutMs: env.AI_TIMEOUT_MS,
    reasoning: env.AI_REASONING,
    logger: log,
  });
}

/** Errors waiting cannot fix: config, refusal, HTTP 4xx (key, model, request). */
const permanent = (e: AiError) =>
  e.kind === 'config' ||
  e.kind === 'refusal' ||
  (e.status !== undefined &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 408 &&
    e.status !== 429);

/**
 * Startup probe: retries (p-retry) until the endpoint answers with a valid
 * structured result or `timeoutMs` is over (a local model may still be
 * loading). Fails at once on errors waiting cannot fix (HTTP 4xx: key, model
 * or request format).
 */
export async function waitForAi(
  ai: AiService,
  opts: {
    timeoutMs: number;
    intervalMs?: number;
    logger?: { info(msg: string, data?: Record<string, unknown>): void };
  },
): Promise<void> {
  let attempts = 0;
  try {
    await pRetry(
      async () => {
        attempts++;
        await ai.probe();
      },
      {
        retries: Number.POSITIVE_INFINITY,
        maxRetryTime: opts.timeoutMs,
        // Backs off (3 s, 6 s, 12 s … at most 30 s) so a rate-limited or
        // loading endpoint is not hammered.
        minTimeout: opts.intervalMs ?? 3000,
        maxTimeout: 30_000,
        factor: 2,
        shouldRetry: ({ error, attemptNumber }) => {
          const err = classify(error);
          if (permanent(err)) return false;
          opts.logger?.info('waiting for the AI endpoint', {
            attempt: attemptNumber,
            kind: err.kind,
          });
          return true;
        },
      },
    );
  } catch (e) {
    const err = classify(e);
    throw new AiError(
      err.kind,
      `AI startup probe failed after ${attempts} attempt(s): ${err.message}`,
      { cause: e, status: err.status },
    );
  }
}

/**
 * For processes that need no AI to start (the web): every call fails with the
 * configuration error, so callers show "KI gerade nicht erreichbar".
 */
export function unavailableAi(error: AiError): AiService {
  const status: AiStatus = {
    lastError: error.message,
    lastErrorAt: new Date().toISOString(),
    lastOkAt: null,
  };
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    interpret: fail,
    interpretCandidateReply: fail,
    writeTexts: fail,
    probe: fail,
    status: () => ({ ...status }),
  };
}
