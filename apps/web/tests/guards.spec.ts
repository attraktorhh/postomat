import { describe, expect, it } from 'vitest';
import { isSameOriginRequest, safeReturnTo } from '../app/server/guards';
import { imageCacheHeaders, notModified } from '../app/server/http';
import { approvedText } from '../app/server/errors';
import { bannerSrc } from '../app/urls';

describe('safeReturnTo', () => {
  it.each([
    ['/redaktion/3', '/redaktion/3'],
    ['/b/1?abgeschickt=1', '/b/1?abgeschickt=1'],
    ['//evil.example/x', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['redaktion', '/'],
    ['/x\r\nset-cookie: a=b', '/'],
    ['/\t/evil.example/x', '/'],
    ['/ /evil.example', '/'],
    ['', '/'],
    [null, '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe('isSameOriginRequest', () => {
  const pub = 'https://postomat.example';
  const post = (headers: Record<string, string>, url = `${pub}/redaktion/1`) =>
    new Request(url, { method: 'POST', headers });

  it('lets GET through', () => {
    expect(
      isSameOriginRequest(
        new Request(`${pub}/x`, {
          headers: { origin: 'https://evil.example' },
        }),
        pub,
      ),
    ).toBe(true);
  });
  it('accepts the public origin and the request origin', () => {
    expect(isSameOriginRequest(post({ origin: pub }), pub)).toBe(true);
    expect(
      isSameOriginRequest(
        post({ origin: 'http://localhost:3000' }, 'http://localhost:3000/x'),
        pub,
      ),
    ).toBe(true);
  });
  it('rejects a foreign or opaque origin', () => {
    expect(
      isSameOriginRequest(post({ origin: 'https://blog.example' }), pub),
    ).toBe(false);
    expect(isSameOriginRequest(post({ origin: 'null' }), pub)).toBe(false);
  });
  it('falls back to Sec-Fetch-Site', () => {
    expect(
      isSameOriginRequest(post({ 'sec-fetch-site': 'same-origin' }), pub),
    ).toBe(true);
    expect(
      isSameOriginRequest(post({ 'sec-fetch-site': 'same-site' }), pub),
    ).toBe(false);
    expect(
      isSameOriginRequest(post({ 'sec-fetch-site': 'cross-site' }), pub),
    ).toBe(false);
  });
  it('allows non-browser clients without either header', () => {
    expect(isSameOriginRequest(post({}), pub)).toBe(true);
  });
});

describe('image caching', () => {
  it('recognises the current ETag', () => {
    const req = (v: string) =>
      new Request('http://x/', { headers: { 'if-none-match': v } });
    expect(notModified(req('"abc"'), 'abc')).toBe(true);
    expect(notModified(req('W/"abc", "def"'), 'abc')).toBe(true);
    expect(notModified(req('"def"'), 'abc')).toBe(false);
    expect(notModified(new Request('http://x/'), 'abc')).toBe(false);
  });
  it('caches only versioned URLs for long', () => {
    expect(imageCacheHeaders('abc', true)['cache-control']).toContain(
      'immutable',
    );
    expect(imageCacheHeaders('abc', false)['cache-control']).toBe(
      'private, no-cache',
    );
  });
  it('builds banner URLs', () => {
    expect(bannerSrc(3, '4x5')).toBe('/banner/3/4x5');
    expect(bannerSrc(3, '16x9', 42, true)).toBe(
      '/banner/3/16x9?b=42&download=1',
    );
  });
});

describe('approvedText', () => {
  it('names the real auto channels', () => {
    expect(approvedText(['wordpress', 'wiki'])).toBe(
      'Freigegeben. Website und Wiki werden jetzt veröffentlicht.',
    );
    expect(approvedText(['wiki'])).toBe(
      'Freigegeben. Wiki wird jetzt veröffentlicht.',
    );
    expect(approvedText([])).toContain('Kopierhilfe');
  });
});
