import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractTarget, env, FakeMediaWiki } from '@postomat/testing';
import {
  MediaWikiClient,
  PageExistsError,
  wikiPageUrl,
  MediaWikiError,
} from '../src/index.ts';

describe(`MediaWiki contract (${contractTarget()})`, { timeout: 30000 }, () => {
  let fake: FakeMediaWiki | undefined;
  let cfg: { apiUrl: string; username: string; password: string };

  beforeAll(async () => {
    if (contractTarget() === 'local') {
      cfg = {
        apiUrl: env('MEDIAWIKI_API_URL', 'http://localhost:8082/api.php'),
        username: env('MEDIAWIKI_BOT_USERNAME', 'Postomat@postomat'),
        password: env(
          'MEDIAWIKI_BOT_PASSWORD',
          'postomatdevbotpassword0123456789',
        ),
      };
    } else {
      fake = await new FakeMediaWiki().start();
      cfg = {
        apiUrl: fake.apiUrl,
        username: fake.username,
        password: fake.password,
      };
    }
  });
  afterAll(async () => fake?.stop());

  it('logs in with the bot password, creates once and never overwrites', async () => {
    const client = new MediaWikiClient(cfg);
    await client.login();
    const title = `Termin:Contract Test ${Date.now()} 2026-12-11`;
    const text =
      '{{Termin\n|date=2026/12/11 06:00:00 PM\n|title=Contract Test\n|visible=Yes\n}}\n\nTest.';
    await client.createPage(title, text, 'Postomat contract test');
    expect(await client.getPageText(title)).toContain('{{Termin');
    await expect(
      client.createPage(title, 'other', 'again'),
    ).rejects.toBeInstanceOf(PageExistsError);
    await client.updatePage(
      title,
      text.replace('|visible=Yes', '|visible=Yes\n|meetupid=123'),
      'meetup',
    );
    expect(await client.getPageText(title)).toContain('|meetupid=123');
  });

  it('refuses to update a missing page', async () => {
    const client = new MediaWikiClient(cfg);
    await expect(
      client.updatePage(`Termin:Fehlt ${Date.now()}`, 'x', 'x'),
    ).rejects.toBeInstanceOf(MediaWikiError);
  });

  it('fails clearly with a wrong password', async () => {
    const client = new MediaWikiClient({ ...cfg, password: 'wrong' });
    await expect(client.login()).rejects.toThrow(/login/i);
  });

  it('builds page URLs', () => {
    expect(
      wikiPageUrl(
        'http://w/index.php/',
        'Termin:Lötkurs für Anfänger 2026-12-11',
      ),
    ).toBe(
      'http://w/index.php/Termin:L%C3%B6tkurs_f%C3%BCr_Anf%C3%A4nger_2026-12-11',
    );
  });
});
