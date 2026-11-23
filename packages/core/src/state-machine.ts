import type { PostStatus } from './types.ts';

/** Allowed post status transitions. Every other transition is rejected. */
export const TRANSITIONS: Readonly<Record<PostStatus, readonly PostStatus[]>> = {
  sammeln: ['zur_freigabe', 'verworfen'],
  zur_freigabe: ['aenderung_gewuenscht', 'geplant', 'verworfen'],
  aenderung_gewuenscht: ['zur_freigabe', 'verworfen'],
  geplant: ['online'],
  online: [],
  verworfen: [],
};

export class InvalidTransitionError extends Error {
  readonly from: PostStatus;
  readonly to: PostStatus;
  constructor(from: PostStatus, to: PostStatus) {
    super(`Invalid post status transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Returns the next version number for a transition. Only
 * `aenderung_gewuenscht → zur_freigabe` ("Erneut zur Freigabe") increments it.
 */
export function nextVersion(from: PostStatus, to: PostStatus, version: number): number {
  assertTransition(from, to);
  return from === 'aenderung_gewuenscht' && to === 'zur_freigabe' ? version + 1 : version;
}
