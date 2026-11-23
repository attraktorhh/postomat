#!/usr/bin/env node
// @nx-target-name: serve
import { BotService, createDepsFromEnv, startHealthServer } from '@postomat/workflow';
import { obtainSession } from './session.ts';
import { SdkMatrix } from './matrix.ts';

const { deps, db, queue } = await createDepsFromEnv('bot');
const session = await obtainSession(deps.env);
const matrix = new SdkMatrix(deps.env.MATRIX_HOMESERVER_URL, session, deps.env.MATRIX_DATA_DIR, deps.log.child('matrix'));
const bot = new BotService({ ...deps, matrix });

let syncing = false;
const health = startHealthServer(deps.env.BOT_HEALTH_PORT, async () => {
  await db.pool.query('select 1');
  return { syncing, userId: session.userId, deviceId: session.deviceId };
});

await bot.registerJobs(queue);
await matrix.start((e) => bot.handle(e));
syncing = true;
deps.log.info('bot started', { userId: session.userId, deviceId: session.deviceId });

const shutdown = async () => {
  deps.log.info('shutting down');
  matrix.stop();
  health.close();
  await queue.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
