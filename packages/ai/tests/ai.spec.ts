import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { emptyAiFacts, loadEnv, type InterpretContext } from '@postomat/core';
import {
  AiError,
  createAiFromEnv,
  createAiService,
  requireAiConfig,
  waitForAi,
  type AiService,
} from '../src/index.ts';

const result = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});

const NOW = new Date('2026-11-23T13:02:00Z'); // Monday, 14:02 in Berlin
const quiet = { warn: () => undefined };

const interpretation = (over: Record<string, unknown> = {}) => ({
  intent: 'provide_info',
  type: 'event',
  facts: {
    ...emptyAiFacts(),
    title: 'Lötkurs für Anfänger',
    date: '2026-11-27',
  },
  consent: null,
  instruction: null,
  text: null,
  ...over,
});

const context: InterpretContext = {
  expecting: 'startTime',
  question: 'Um wie viel Uhr geht’s los?',
  type: 'event',
  facts: { title: 'Lötkurs für Anfänger', date: '2026-11-27' },
  hasPhoto: false,
  openRueckfrage: null,
  pendingConfirmation: null,
};

function service(
  doGenerate: MockLanguageModelV4['doGenerate'],
  timeoutMs = 1000,
) {
  const model = new MockLanguageModelV4({ doGenerate });
  return { model, ai: createAiService(model, { timeoutMs, logger: quiet }) };
}

async function failure(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error('expected an AiError');
}

describe('AiService.interpret', () => {
  it('returns the structured result and sends now, timezone and context but no IDs or names', async () => {
    const { model, ai } = service(
      async () => result(interpretation()) as never,
    );
    const r = await ai.interpret({
      text: 'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      context,
      now: NOW,
    });
    expect(r.intent).toBe('provide_info');
    expect(r.facts.date).toBe('2026-11-27');
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(sent).toContain('Montag, 2026-11-23, 14:02 Uhr');
    expect(sent).toContain('Europe/Berlin');
    expect(sent).toContain('startTime'); // expected answer
    expect(sent).toContain('Lötkurs für Anfänger'); // known facts
    expect(sent).not.toMatch(/@\w+:/);
    expect(sent).not.toMatch(/lena|kai|mira/i);
  });

  it('retries once on a schema mismatch, then fails with a typed error', async () => {
    const { model, ai } = service(
      async () => result({ nonsense: true }) as never,
    );
    const e = await failure(ai.interpret({ text: 'x', context, now: NOW }));
    expect(e.kind).toBe('schema');
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(ai.status().lastError).toBe('interpret: schema');
  });

  it('accepts a valid result on the schema retry', async () => {
    let n = 0;
    const { ai } = service(
      async () =>
        (n++ === 0
          ? result({ intent: 'nope' })
          : result(interpretation())) as never,
    );
    expect((await ai.interpret({ text: 'x', context, now: NOW })).intent).toBe(
      'provide_info',
    );
  });

  it('fails with kind timeout when the model does not answer in time', async () => {
    const { ai } = service(
      (opts) =>
        new Promise((_, reject) =>
          opts.abortSignal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          }),
        ),
      50,
    );
    expect(
      (await failure(ai.interpret({ text: 'x', context, now: NOW }))).kind,
    ).toBe('timeout');
  });

  it('fails with kind http on an endpoint error', async () => {
    const { ai } = service(async () => {
      throw new APICallError({
        message: 'down',
        url: 'http://llm.test',
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: false,
      });
    });
    const e = await failure(ai.interpret({ text: 'x', context, now: NOW }));
    expect(e.kind).toBe('http');
    expect(e.message).toContain('503');
  });
});

describe('AiService.interpretCandidateReply', () => {
  const candidates = [
    { title: 'Lötkurs', date: '2026-12-11', time: '18:00' },
    { title: 'Löten für Kids', date: '2026-12-11', time: '18:30' },
  ];
  it.each([
    [2, { choice: 2 }],
    ['none', { choice: 'none' }],
    ['unrelated', { choice: 'unrelated' }],
    [5, { choice: 'unrelated' }],
  ] as const)('maps %j', async (choice, expected) => {
    const { model, ai } = service(async () => result({ choice }) as never);
    expect(
      await ai.interpretCandidateReply({ text: 'das zweite', candidates }),
    ).toEqual(expected);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain(
      'Löten für Kids',
    );
  });
  it('throws on failure', async () => {
    const { ai } = service(async () => result({}) as never);
    expect(
      (await failure(ai.interpretCandidateReply({ text: '2', candidates })))
        .kind,
    ).toBe('schema');
  });
});

describe('AiService.writeTexts', () => {
  const texts = {
    hookDe: 'Lust auf Löten? 🔥',
    bodyDe: 'Du lernst löten.',
    titleEn: 'Soldering',
    bodyEn: 'You learn soldering.',
    shortEn: 'Soldering at Attraktor.',
    costsEn: '€5 for material',
  };
  it('returns the texts', async () => {
    const { ai } = service(async () => result(texts) as never);
    expect(
      await ai.writeTexts({ type: 'event', facts: { title: 'Lötkurs' } }),
    ).toEqual(texts);
  });
  it('never returns empty texts', async () => {
    const { ai } = service(
      async () => result({ ...texts, bodyDe: ' ' }) as never,
    );
    expect(
      (await failure(ai.writeTexts({ type: 'event', facts: {} }))).kind,
    ).toBe('schema');
  });
});

describe('configuration and startup', () => {
  it('requires AI_BASE_URL and AI_MODEL', () => {
    expect(() => requireAiConfig(loadEnv({}))).toThrow(
      'AI configuration missing: AI_BASE_URL, AI_MODEL',
    );
    expect(() =>
      createAiFromEnv(loadEnv({ AI_BASE_URL: 'http://localhost:11434/v1' })),
    ).toThrow('AI configuration missing: AI_MODEL');
    expect(
      createAiFromEnv(
        loadEnv({ AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'm' }),
      ),
    ).toBeTruthy();
  });

  it('has no switch to disable AI', () => {
    expect(() => loadEnv({ AI_PROVIDER: 'none' })).toThrow();
  });

  it('waits for the endpoint and succeeds once the probe answers', async () => {
    let n = 0;
    const { ai } = service(async () => {
      if (n++ < 2) throw new Error('connect ECONNREFUSED');
      return result(interpretation({ intent: 'smalltalk_or_thanks' })) as never;
    });
    await waitForAi(ai, { timeoutMs: 2000, intervalMs: 10 });
    expect(n).toBe(3);
  });

  it('gives up after the startup timeout', async () => {
    const ai: AiService = {
      ...service(async () => result({}) as never).ai,
      probe: async () => {
        throw new AiError('http', 'connect ECONNREFUSED');
      },
    };
    const e = await failure(waitForAi(ai, { timeoutMs: 50, intervalMs: 20 }));
    expect(e.message).toContain('AI startup probe failed');
  });
});
