import { describe, expect, it } from 'vitest';
import { POST_STATUSES, type PostStatus } from '../src/types.ts';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  nextVersion,
} from '../src/state-machine.ts';

const VALID: Array<[PostStatus, PostStatus]> = [
  ['sammeln', 'zur_freigabe'],
  ['sammeln', 'verworfen'],
  ['zur_freigabe', 'aenderung_gewuenscht'],
  ['zur_freigabe', 'geplant'],
  ['zur_freigabe', 'verworfen'],
  ['aenderung_gewuenscht', 'zur_freigabe'],
  ['aenderung_gewuenscht', 'verworfen'],
  ['geplant', 'online'],
];

describe('post state machine', () => {
  const all = POST_STATUSES.flatMap((from) =>
    POST_STATUSES.map((to) => [from, to] as [PostStatus, PostStatus]),
  );

  it.each(VALID)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const invalid = all.filter(
    ([f, t]) => !VALID.some(([a, b]) => a === f && b === t),
  );
  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('covers every pair', () => {
    expect(VALID.length + invalid.length).toBe(36);
  });

  it('increments the version only when resubmitting after a change request', () => {
    expect(nextVersion('aenderung_gewuenscht', 'zur_freigabe', 1)).toBe(2);
    expect(nextVersion('sammeln', 'zur_freigabe', 1)).toBe(1);
    expect(nextVersion('zur_freigabe', 'geplant', 3)).toBe(3);
    expect(() => nextVersion('online', 'zur_freigabe', 1)).toThrow(
      InvalidTransitionError,
    );
  });
});
