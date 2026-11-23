import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { loadEnv } from '@postomat/core';
import { createAiFromEnv, createAiService } from '../src/index.ts';

const result = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});

const NOW = new Date('2026-11-23T13:02:00Z');
const quiet = { warn: vi.fn() };

describe('AI service', () => {
  it('extracts type and facts and sends no Matrix IDs', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: result({
        type: 'event',
        title: 'Lötkurs für Anfänger',
        description: 'Du lernst löten.',
        date: '2026-11-27',
        startTime: null,
        endTime: null,
        places: null,
        costs: null,
        audience: null,
        trickiest: null,
        isWorkshop: true,
      }) as never,
    });
    const ai = createAiService(model, { timeoutMs: 1000, logger: quiet });
    const r = await ai.extract({ text: 'Ich will nächsten Freitag einen Lötkurs machen', facts: {}, now: NOW });
    expect(r).toEqual({
      type: 'event',
      facts: { title: 'Lötkurs für Anfänger', description: 'Du lernst löten.', date: '2026-11-27', isWorkshop: true },
    });
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(sent).not.toMatch(/@\w+:/);
    expect(sent).toContain('2026-11-23');
  });

  it('writes texts', async () => {
    const texts = { hookDe: 'Lust auf Löten? 🔥', bodyDe: 'Du lernst.', titleEn: 'Soldering', bodyEn: 'You learn.', shortEn: 'Learn it.' };
    const ai = createAiService(new MockLanguageModelV4({ doGenerate: result(texts) as never }), { timeoutMs: 1000, logger: quiet });
    expect(await ai.writeTexts({ type: 'event', facts: { title: 'Lötkurs' } })).toEqual(texts);
  });

  it('returns null and logs a warning on errors', async () => {
    const logger = { warn: vi.fn() };
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('boom');
      },
    });
    const ai = createAiService(model, { timeoutMs: 1000, logger });
    expect(await ai.extract({ text: 'x', facts: {}, now: NOW })).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null on timeout', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (opts) =>
        new Promise((_, reject) => opts.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    const ai = createAiService(model, { timeoutMs: 50, logger: quiet });
    expect(await ai.writeTexts({ type: 'event', facts: {} })).toBeNull();
  });

  it('is disabled with AI_PROVIDER=none (default)', () => {
    expect(createAiFromEnv(loadEnv({}))).toBeNull();
    expect(createAiFromEnv(loadEnv({ AI_PROVIDER: 'openai-compatible' }), quiet)).toBeNull();
    expect(
      createAiFromEnv(loadEnv({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'x' })),
    ).not.toBeNull();
  });
});
