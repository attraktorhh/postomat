import { describe, expect, it } from 'vitest';
import { InMemoryQueue } from '../src/queue.ts';

describe('InMemoryQueue', () => {
  it('retries failed jobs and flags the last attempt', async () => {
    const q = new InMemoryQueue(2);
    const seen: Array<[number, boolean]> = [];
    await q.work('bot.card', async (_d, meta) => {
      seen.push([meta.attempt, meta.isLastAttempt]);
      throw new Error('boom');
    });
    await q.send('bot.card', { postId: 1 });
    await q.drain();
    expect(seen).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(q.failures).toHaveLength(3);
  });

  it('deduplicates pending jobs with a singleton key', async () => {
    const q = new InMemoryQueue();
    let runs = 0;
    await q.work('publish.channel', async () => {
      runs++;
    });
    await q.send(
      'publish.channel',
      { postId: 1, channel: 'wordpress' },
      { singletonKey: '1:wordpress' },
    );
    await q.send(
      'publish.channel',
      { postId: 1, channel: 'wordpress' },
      { singletonKey: '1:wordpress' },
    );
    await q.drain();
    expect(runs).toBe(1);
  });
});
