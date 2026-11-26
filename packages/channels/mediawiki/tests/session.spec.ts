import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMediaWiki } from '@postomat/testing';
import { MediaWikiClient, MediaWikiError } from '../src/index.ts';

describe('MediaWiki session handling (fake)', () => {
  let fake: FakeMediaWiki;
  beforeAll(async () => {
    fake = await new FakeMediaWiki().start();
  });
  afterAll(async () => fake.stop());

  it('logs in again once when the wiki session expired', async () => {
    const client = new MediaWikiClient({
      apiUrl: fake.apiUrl,
      username: fake.username,
      password: fake.password,
    });
    await client.createPage('Termin:A 2026-12-11', 'a', 'test');
    fake.expireSessions();
    await client.createPage('Termin:B 2026-12-11', 'b', 'test');
    fake.expireSessions();
    await client.updatePage('Termin:A 2026-12-11', 'a2', 'test');
    expect(fake.pages.get('Termin:A 2026-12-11')).toBe('a2');
    expect(fake.pages.get('Termin:B 2026-12-11')).toBe('b');
  });

  it('keeps reporting the login error instead of reusing a half-open session', async () => {
    const client = new MediaWikiClient({
      apiUrl: fake.apiUrl,
      username: fake.username,
      password: 'wrong',
    });
    for (let i = 0; i < 2; i++) {
      const err = await client
        .createPage('Termin:C 2026-12-11', 'c', 'test')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MediaWikiError);
      expect((err as MediaWikiError).code).toBe('login');
    }
    expect(fake.pages.has('Termin:C 2026-12-11')).toBe(false);
  });
});
