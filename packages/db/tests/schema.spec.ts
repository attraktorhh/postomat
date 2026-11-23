import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  posts,
  runMigrations,
  sql,
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
    await h.db.execute(sql`truncate posts restart identity cascade`);
  });
  afterAll(async () => h?.close());

  it('allows only one draft per member', async () => {
    const base = {
      type: 'event' as const,
      authorMatrixId: '@lena:localhost',
      authorUsername: 'lena',
    };
    await h.db.insert(posts).values(base);
    await expect(h.db.insert(posts).values(base)).rejects.toThrow();
    await h.db.insert(posts).values({ ...base, status: 'zur_freigabe' });
    expect((await h.db.select().from(posts)).length).toBe(2);
  });

  it('stores facts as JSON', async () => {
    const [row] = await h.db
      .insert(posts)
      .values({
        type: 'projekt',
        authorMatrixId: '@kai:localhost',
        authorUsername: 'kai',
        facts: { title: 'Nixie-Uhr', places: 3 },
      })
      .returning();
    expect(row.facts).toEqual({ title: 'Nixie-Uhr', places: 3 });
    expect(row.version).toBe(1);
    expect(row.bannerColor).toBe('mint');
  });
});
