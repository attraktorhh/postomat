#!/usr/bin/env node
// @nx-target-name: serve
import {
  createDepsFromEnv,
  registerWorkerJobs,
  scheduleWorkerJobs,
  startHealthServer,
} from '@postomat/workflow';

const { deps, db, queue } = await createDepsFromEnv('worker');
await registerWorkerJobs(deps, queue);
await scheduleWorkerJobs(deps, queue);
const health = startHealthServer(deps.env.WORKER_HEALTH_PORT, async () => {
  await db.pool.query('select 1');
  return { queue: 'pg-boss' };
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
