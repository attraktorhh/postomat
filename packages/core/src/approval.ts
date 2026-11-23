import type { ChannelPostSnapshot, PhotoSnapshot, PostSnapshot } from './types.ts';
import { blockingFailures, runChecks, type CheckResult } from './checks.ts';

export type ApprovalDecision =
  | { kind: 'approve'; checks: CheckResult[] }
  | { kind: 'self_approval' }
  | { kind: 'not_medienteam' }
  | { kind: 'wrong_state' }
  | { kind: 'outdated_version' }
  | { kind: 'blocked'; failures: CheckResult[] };

export interface ApprovalInput {
  post: PostSnapshot;
  channels: ChannelPostSnapshot[];
  photos: PhotoSnapshot[];
  now: Date;
  approverUsername: string;
  approverIsMedienteam: boolean;
  /** The card version the 👍 was given on (the web always approves the current one). */
  version: number;
  meetupCategory?: string | null;
}

/**
 * Decides whether an approval (👍 in Matrix or "Freigeben" in the web) is valid.
 * Order matters: unauthorised users are ignored silently by the caller,
 * the author gets a friendly refusal, outdated or wrong-state cards get a hint.
 */
export function decideApproval(input: ApprovalInput): ApprovalDecision {
  const { post } = input;
  if (!input.approverIsMedienteam) return { kind: 'not_medienteam' };
  if (input.approverUsername === post.authorUsername) return { kind: 'self_approval' };
  if (post.status === 'aenderung_gewuenscht') return { kind: 'outdated_version' };
  if (post.status !== 'zur_freigabe') return { kind: 'wrong_state' };
  if (input.version !== post.version) return { kind: 'outdated_version' };
  const checks = runChecks({
    post,
    channels: input.channels,
    photos: input.photos,
    now: input.now,
    approverUsername: input.approverUsername,
    meetupCategory: input.meetupCategory,
  });
  const failures = blockingFailures(checks);
  if (failures.length) return { kind: 'blocked', failures };
  return { kind: 'approve', checks };
}
