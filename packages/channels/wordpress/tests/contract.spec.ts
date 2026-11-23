import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractTarget, env, FakeWordPress } from '@postomat/testing';
import { WordPressClient } from '../src/index.ts';

describe(`WordPress contract (${contractTarget()})`, () => {
  let fake: FakeWordPress | undefined;
  let client: WordPressClient;
  const created: number[] = [];

  beforeAll(async () => {
    if (contractTarget() === 'local') {
      client = new WordPressClient({
        baseUrl: env('WORDPRESS_URL', 'http://localhost:8081'),
        username: env('WORDPRESS_USERNAME', 'postomat'),
        appPassword: env(
          'WORDPRESS_APP_PASSWORD',
          'dev0 dev0 dev0 dev0 dev0 dev0',
        ),
      });
    } else {
      fake = await new FakeWordPress().start();
      client = new WordPressClient({
        baseUrl: fake.url,
        username: fake.username,
        appPassword: fake.appPassword,
      });
    }
  });

  afterAll(async () => {
    for (const id of created)
      await client.deletePost(id).catch(() => undefined);
    await fake?.stop();
  });

  it('authenticates with the application password', async () => {
    expect((await client.me()).slug).toBe('postomat');
  });

  it('resolves category slugs and reports unknown ones', async () => {
    const ids = await client.resolveCategoryIds(['termine', 'workshops']);
    expect(ids).toHaveLength(2);
    await expect(client.resolveCategoryIds(['gibt-es-nicht'])).rejects.toThrow(
      /not found/,
    );
  });

  it('uploads media, creates, finds and updates a post', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const media = await client.uploadMedia(
      png,
      'contract-test.png',
      'image/png',
      'Test',
    );
    expect(media.id).toBeGreaterThan(0);
    const [termine] = await client.resolveCategoryIds(['termine']);
    const slug = `postomat-contract-${Date.now()}`;
    const post = await client.createPost({
      title: 'Contract Test',
      content: '<p>Hallo</p>',
      status: 'draft',
      slug,
      categories: [termine],
      featuredMedia: media.id,
    });
    created.push(post.id);
    expect((await client.findPostBySlug(slug))?.id).toBe(post.id);
    await client.updatePost(post.id, { content: '<p>Neu</p>' });
    const read = await client.getPost(post.id);
    expect(read.content).toContain('Neu');
    expect(read.categories).toContain(termine);
    expect(read.featured_media).toBe(media.id);
  });

  it('returns null for an unknown slug', async () => {
    expect(
      await client.findPostBySlug(`gibt-es-nicht-${Date.now()}`),
    ).toBeNull();
  });
});
