import { describe, expect, it } from 'vitest';
import type { ChannelPost, Post } from '@postomat/db';
import {
  getPost,
  isDbId,
  NotFoundError,
  reviewStamp,
  textsOutdated,
  toSnapshot,
} from '../src/repo.ts';

const post = (over: Partial<Post> = {}): Post =>
  ({
    id: 1,
    type: 'event',
    status: 'zur_freigabe',
    version: 1,
    authorMatrixId: '@lena:localhost',
    authorUsername: 'lena',
    facts: { title: 'Lötkurs', date: '2026-12-11', startTime: '18:00' },
    textsFacts: { startTime: '18:00', date: '2026-12-11', title: 'Lötkurs' },
    textsError: null,
    ...over,
  }) as Post;

describe('texts freshness', () => {
  it('ignores key order and an unset workshop flag', () => {
    expect(textsOutdated(post())).toBe(false);
    expect(
      textsOutdated(post({ facts: { ...post().facts, isWorkshop: false } })),
    ).toBe(false);
    expect(
      textsOutdated(post({ facts: { ...post().facts, isWorkshop: true } })),
    ).toBe(true);
    expect(
      textsOutdated(post({ facts: { ...post().facts, endTime: '21:00' } })),
    ).toBe(true);
  });

  it('counts posts from before texts_facts as current, failures as not', () => {
    expect(toSnapshot(post({ textsFacts: null })).textsCurrent).toBe(true);
    const failed = toSnapshot(post({ textsError: 'http' }));
    expect(failed.textsCurrent).toBe(false);
    expect(failed.textsFailed).toBe(true);
    expect(
      toSnapshot(post({ facts: { ...post().facts, places: 8 } })).textsCurrent,
    ).toBe(false);
  });

  it('review stamp changes with any text or fact, not with row order', () => {
    const ch = (channel: string, textDe: string) =>
      ({
        channel,
        textDe,
        textEn: '',
        fields: { b: '1', a: '2' },
      }) as never as ChannelPost;
    const rows = [ch('wordpress', 'A'), ch('wiki', 'B')];
    const s = reviewStamp(post(), rows);
    expect(reviewStamp(post(), [...rows].reverse())).toBe(s);
    expect(reviewStamp(post(), [ch('wordpress', 'A!'), rows[1]])).not.toBe(s);
    expect(
      reviewStamp(post({ facts: { ...post().facts, endTime: '21:00' } }), rows),
    ).not.toBe(s);
  });
});

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
