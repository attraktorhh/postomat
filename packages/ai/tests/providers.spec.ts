import { describe, expect, it } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { emptyAiFacts, loadEnv, type InterpretContext } from '@postomat/core';
import {
  AiError,
  createAiFromEnv,
  createAiService,
  waitForAi,
} from '../src/index.ts';

// Provider round trips over a fake fetch, startup fast-fail with real
// provider errors, and what failures write to the log.

const NOW = new Date('2026-11-23T13:02:00Z');
const quiet = { warn: () => undefined };

const interpretation = () => ({
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
});

const context: InterpretContext = {
  expecting: 'startTime',
  type: 'event',
  facts: { title: 'Lötkurs für Anfänger' },
  hasPhoto: false,
  openRueckfrage: null,
  pendingConfirmation: null,
};

const mockResult = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});

async function failure(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error('expected an AiError');
}

type Reply = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

/** A fake HTTP endpoint that records what the provider package sends. */
function http(reply: () => Reply) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const r = reply();
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const chatCompletion = (content: string) => ({
  id: 'x',
  object: 'chat.completion',
  created: 0,
  model: 'm',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

describe('provider HTTP round trips', () => {
  it('openai: Responses API with a named JSON schema', async () => {
    const h = http(() => ({
      body: {
        id: 'resp_1',
        object: 'response',
        created_at: 0,
        model: 'gpt-test',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(interpretation()),
                annotations: [],
              },
            ],
          },
        ],
        incomplete_details: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }));
    const ai = createAiFromEnv(
      loadEnv({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test', AI_API_KEY: 'k' }),
      quiet,
      { fetch: h.fetch },
    );
    const r = await ai.interpret({ text: 'x', context, now: NOW });
    expect(r.facts.title).toBe('Lötkurs für Anfänger');
    expect(h.requests[0].url).toBe('https://api.openai.com/v1/responses');
    const text = h.requests[0].body['text'] as {
      format: Record<string, unknown>;
    };
    expect(text.format['type']).toBe('json_schema');
    expect(text.format['name']).toBe('interpretation');
  });

  it('anthropic: Messages API with the schema in the request', async () => {
    const h = http(() => ({
      body: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: JSON.stringify(interpretation()) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }));
    const ai = createAiFromEnv(
      loadEnv({
        AI_PROVIDER: 'anthropic',
        AI_MODEL: 'claude-sonnet-4-5',
        AI_API_KEY: 'k',
      }),
      quiet,
      { fetch: h.fetch },
    );
    const r = await ai.interpret({ text: 'x', context, now: NOW });
    expect(r.intent).toBe('provide_info');
    expect(h.requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.stringify(h.requests[0].body)).toContain('"intent"');
    // The provider fills in max_tokens (required by Anthropic) itself.
    expect(h.requests[0].body['max_tokens']).toBeGreaterThan(0);
  });

  it('openai-compatible: names the schema, sends no maxLength or max_tokens', async () => {
    const h = http(() => ({
      body: chatCompletion(JSON.stringify(interpretation())),
    }));
    const ai = createAiFromEnv(
      loadEnv({ AI_BASE_URL: 'http://llm.test/v1', AI_MODEL: 'm' }),
      quiet,
      { fetch: h.fetch },
    );
    await ai.interpret({ text: 'x', context, now: NOW });
    const rf = h.requests[0].body['response_format'] as {
      json_schema: { name: string };
    };
    expect(rf.json_schema.name).toBe('interpretation');
    expect(JSON.stringify(rf)).not.toContain('maxLength');
    expect(h.requests[0].body['max_tokens']).toBeUndefined();
  });

  it.each(['json', 'json_schema'])(
    'parses JSON wrapped in a ```json fence (%s mode)',
    async (mode) => {
      const fenced = '```json\n' + JSON.stringify(interpretation()) + '\n```';
      const h = http(() => ({ body: chatCompletion(fenced) }));
      const ai = createAiFromEnv(
        loadEnv({
          AI_BASE_URL: 'http://llm.test/v1',
          AI_MODEL: 'm',
          AI_STRUCTURED_OUTPUT: mode,
        }),
        quiet,
        { fetch: h.fetch },
      );
      const r = await ai.interpret({ text: 'x', context, now: NOW });
      expect(r.facts.date).toBe('2026-11-27');
      expect(h.requests).toHaveLength(1);
    },
  );
});

describe('startup probe against real provider errors', () => {
  const probing = (status: number) => {
    const h = http(() => ({
      status,
      body: { error: { message: 'nope' } },
      headers: { 'retry-after-ms': '5' },
    }));
    const ai = createAiFromEnv(
      loadEnv({
        AI_BASE_URL: 'http://llm.test/v1',
        AI_MODEL: 'm',
        AI_TIMEOUT_MS: '500',
      }),
      quiet,
      { fetch: h.fetch },
    );
    return { ai, requests: h.requests };
  };

  it('a 401 fails after one attempt', async () => {
    const { ai, requests } = probing(401);
    const e = await failure(waitForAi(ai, { timeoutMs: 5000, intervalMs: 10 }));
    expect(e.status).toBe(401);
    expect(e.message).toBe(
      'AI startup probe failed after 1 attempt(s): AI endpoint returned 401',
    );
    expect(requests).toHaveLength(1);
  });

  it('a 429 keeps waiting', async () => {
    const { ai, requests } = probing(429);
    const e = await failure(waitForAi(ai, { timeoutMs: 300, intervalMs: 10 }));
    expect(e.message).toContain('AI startup probe failed');
    expect(requests.length).toBeGreaterThan(2);
  });
});

describe('failure logging', () => {
  const SECRET = 'GEHEIMER TEXT';
  function recorded(doGenerate: MockLanguageModelV4['doGenerate']) {
    const lines: string[] = [];
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: (o) => {
        calls++;
        return doGenerate(o);
      },
    });
    const ai = createAiService(model, {
      timeoutMs: 100,
      logger: { warn: (m, d) => lines.push(`${m} ${JSON.stringify(d)}`) },
    });
    return { ai, lines, calls: () => calls };
  }
  const refusal = {
    ...mockResult({}),
    content: [],
    finishReason: {
      unified: 'content-filter' as const,
      raw: 'content_filter',
    },
  };
  const generators: Record<string, MockLanguageModelV4['doGenerate']> = {
    schema: async () => mockResult({ nonsense: SECRET }) as never,
    http: async () => {
      throw new APICallError({
        message: `bad request: ${SECRET}`,
        url: 'http://llm.test',
        requestBodyValues: { prompt: SECRET },
        statusCode: 500,
        responseBody: SECRET,
        isRetryable: false,
      });
    },
    refusal: async () => refusal as never,
    timeout: (opts) =>
      new Promise((_, reject) =>
        opts.abortSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        }),
      ),
  };

  it.each(Object.keys(generators))(
    '%s: typed error, no message text in the log',
    async (kind) => {
      const { ai, lines } = recorded(generators[kind]);
      const e = await failure(
        ai.interpret({ text: SECRET, context, now: NOW }),
      );
      expect(e.kind).toBe(kind);
      expect(e.message).not.toContain(SECRET);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join('\n')).not.toContain(SECRET);
    },
  );

  it('a refusal is not retried', async () => {
    const { ai, calls } = recorded(generators['refusal']);
    await failure(ai.interpret({ text: 'x', context, now: NOW }));
    expect(calls()).toBe(1);
  });
});
