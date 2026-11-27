import { describe, expect, it } from 'vitest';
import { loggableError } from '../src/bot.ts';

describe('loggableError', () => {
  it('drops the query parameters (member text) of a database error', () => {
    const cause = Object.assign(
      new Error('invalid input syntax for type integer: "GEHEIM"'),
      { code: '22P02' },
    );
    // As drizzle-orm's DrizzleQueryError builds it.
    const e = new Error(
      'Failed query: update "posts" set "note" = $1\nparams: GEHEIME NOTIZ von Lena',
      { cause },
    );
    e.name = 'DrizzleQueryError';
    const out = loggableError(e);
    expect(out).not.toContain('GEHEIME');
    expect(out).not.toContain('update "posts"');
    expect(out).toContain('DrizzleQueryError: query failed (22P02)');
    expect(out).toMatch(/\n\s+at /);
  });

  it('keeps ordinary errors', () => {
    expect(loggableError(new TypeError('x is undefined'))).toMatch(
      /^TypeError: x is undefined/,
    );
    expect(loggableError('boom')).toBe('non-error thrown');
  });
});
