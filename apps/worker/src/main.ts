#!/usr/bin/env node
// @nx-target-name: serve
import {
  createDepsFromEnv,
  registerWorkerJobs,
  scheduleWorkerJobs,
  startHealthServer,
} from '@postomat/workflow';

const { deps, db, queue } = await createDepsFromEnv('worker').catch(
  (e: unknown) => {
    // Missing AI config or an AI endpoint that never answered: refuse to start.
    console.error(
      `[worker] startup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  },
);
await registerWorkerJobs(deps, queue);
await scheduleWorkerJobs(deps, queue);
const health = startHealthServer(deps.env.WORKER_HEALTH_PORT, async () => {
  await db.pool.query('select 1');
  return { queue: 'pg-boss', ai: deps.ai.status() };
});
deps.log.info('worker started', {
  meetupPollEveryMin: deps.env.MEETUP_POLL_INTERVAL_MIN,
});

const shutdown = async () => {
  health.close();
  await queue.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
