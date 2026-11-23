import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractTarget, env, FakeWebDav } from '@postomat/testing';
import { photoFolder, WebDavClient } from '../src/index.ts';

describe(`WebDAV contract (${contractTarget()})`, () => {
  let fake: FakeWebDav | undefined;
  let client: WebDavClient;
  const root = `/Postomat-Fotos/contract-${Date.now()}`;

  beforeAll(async () => {
    if (contractTarget() === 'local') {
      client = new WebDavClient({
        baseUrl: env(
          'NEXTCLOUD_WEBDAV_URL',
          'http://localhost:8083/remote.php/dav/files/postomat',
        ),
        username: env('NEXTCLOUD_USERNAME', 'postomat'),
        password: env('NEXTCLOUD_PASSWORD', 'postomat-nextcloud-dev'),
      });
    } else {
      fake = await new FakeWebDav().start();
      client = new WebDavClient({
        baseUrl: fake.url,
        username: fake.username,
        password: fake.password,
      });
    }
  });
  afterAll(async () => {
    await client.delete(root).catch(() => undefined);
    await fake?.stop();
  });

  it('creates nested folders idempotently, stores and reads a file', async () => {
    const dir = `${root}/2026/2026-12-11-lötkurs`;
    await client.ensureDir(dir);
    await client.ensureDir(dir);
    expect(await client.exists(dir)).toBe(true);
    await client.put(`${dir}/1.jpg`, Buffer.from('hello'), 'image/jpeg');
    expect((await client.get(`${dir}/1.jpg`)).toString()).toBe('hello');
    expect(await client.exists(`${dir}/fehlt.jpg`)).toBe(false);
  });

  it('builds the folder pattern', () => {
    expect(photoFolder('/Postomat-Fotos', '2026-12-11', 'loetkurs')).toBe(
      '/Postomat-Fotos/2026/2026-12-11-loetkurs',
    );
  });
});
