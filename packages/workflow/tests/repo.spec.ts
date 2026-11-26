import { describe, expect, it } from 'vitest';
import { getPost, isDbId, NotFoundError } from '../src/repo.ts';

describe('getPost with ids from URLs', () => {
  it('accepts only positive Postgres integers', () => {
    expect(isDbId(7)).toBe(true);
    for (const id of [NaN, 0, -1, 1.5, 2_147_483_648])
      expect(isDbId(id)).toBe(false);
  });

  it('throws NotFoundError without querying for an invalid id', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('database must not be queried');
        },
      },
    );
    await expect(
      getPost(db as never, Number('does-not-exist')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
