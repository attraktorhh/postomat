import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceRoot } from '@postomat/core';

/**
 * Bot and worker refuse to start without a working AI. The real entry points
 * run as child processes; the AI check comes before Postgres or Matrix.
 */
function start(
  app: 'bot' | 'worker',
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--conditions=@postomat/source', `apps/${app}/src/main.ts`],
      {
        cwd: workspaceRoot(),
        env: {
          PATH: process.env['PATH'] ?? '',
          NODE_ENV: 'test',
          LOG_LEVEL: 'error',
          // unreachable on purpose: the process must stop before using them
          DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:9/none',
          MATRIX_HOMESERVER_URL: 'http://127.0.0.1:9',
          AI_BASE_URL: '',
          AI_MODEL: '',
          ...env,
        },
      },
    );
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe('startup without a working AI', () => {
  // An "LLM" that answers every request with HTTP 500.
  let broken: Server;
  let brokenUrl = '';
  beforeAll(async () => {
    broken = createServer((_req, res) => res.writeHead(500).end('{}'));
    await new Promise<void>((r) => broken.listen(0, '127.0.0.1', r));
    brokenUrl = `http://127.0.0.1:${(broken.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((r) => broken.close(() => r())));

  it.each(['worker', 'bot'] as const)(
    '%s exits non-zero when AI_BASE_URL / AI_MODEL are missing',
    async (app) => {
      const r = await start(app, {});
      expect(r.code).not.toBe(0);
      expect(r.output).toContain(
        'AI configuration missing: AI_BASE_URL, AI_MODEL',
      );
    },
    30000,
  );

  it.each(['worker', 'bot'] as const)(
    '%s exits non-zero when the startup probe keeps failing',
    async (app) => {
      const r = await start(app, {
        AI_BASE_URL: brokenUrl,
        AI_MODEL: 'test-model',
        AI_STARTUP_TIMEOUT_MS: '1000',
      });
      expect(r.code).not.toBe(0);
      expect(r.output).toContain('AI startup probe failed');
    },
    30000,
  );
});
