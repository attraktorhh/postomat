import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  posts,
  runMigrations,
  type DbHandle,
} from '../src/index.ts';

const URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://postomat:postomat@localhost:55432/postomat_test';

describe('schema (Postgres)', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = createDb(URL, 2);
    await runMigrations(h.db);
    await runMigrations(h.db); // idempotent
  });
  afterAll(async () => h?.close());

  // No truncate: the e2e suite may use the same test database in parallel.
  const uid = () => `@t${Date.now()}${Math.floor(Math.random() * 1e6)}:test`;

  it('allows only one draft per member', async () => {
    const author = uid();
    const base = {
      type: 'event' as const,
      authorMatrixId: author,
      authorUsername: 'tester',
    };
    await h.db.insert(posts).values(base);
    await expect(h.db.insert(posts).values(base)).rejects.toThrow();
    await h.db.insert(posts).values({ ...base, status: 'zur_freigabe' });
    expect(
      (await h.db.select().from(posts).where(eq(posts.authorMatrixId, author)))
        .length,
    ).toBe(2);
  });

  it('stores facts as JSON', async () => {
    const [row] = await h.db
      .insert(posts)
      .values({
        type: 'projekt',
        authorMatrixId: uid(),
        authorUsername: 'kai',
        facts: { title: 'Nixie-Uhr', places: 3 },
      })
      .returning();
    expect(row.facts).toEqual({ title: 'Nixie-Uhr', places: 3 });
    expect(row.version).toBe(1);
    expect(row.bannerColor).toBe('mint');
  });
});
