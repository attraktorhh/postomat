import { lt, processedEvents, sessions, sql } from '@postomat/db';
import type { WorkflowDeps } from './deps.ts';

/**
 * Worker job: keeps two append-only tables small. Processed Matrix event ids
 * only guard against sync re-delivery, so a week is plenty; expired web
 * sessions are useless.
 */
export async function cleanupOldRows(
  deps: WorkflowDeps,
): Promise<{ events: number; sessions: number }> {
  const events = await deps.db
    .delete(processedEvents)
    .where(lt(processedEvents.createdAt, sql`now() - interval '7 days'`))
    .returning({ id: processedEvents.eventId });
  const expired = await deps.db
    .delete(sessions)
    .where(lt(sessions.expiresAt, sql`now()`))
    .returning({ id: sessions.id });
  return { events: events.length, sessions: expired.length };
}
