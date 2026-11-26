import { InvalidTransitionError, STATUS_LABELS } from '@postomat/core';

/** Message for a failed form action, in German for invalid status changes. */
export function actionError(e: unknown): string {
  if (e instanceof InvalidTransitionError)
    return `Das geht im Status „${STATUS_LABELS[e.from]}“ nicht (nicht möglich: ${STATUS_LABELS[e.to]}).`;
  return e instanceof Error ? e.message : String(e);
}
