import './env-load.server';
import { createDepsFromEnv, type WorkflowDeps } from '@postomat/workflow';

type Handle = Awaited<ReturnType<typeof createDepsFromEnv>>;
const g = globalThis as typeof globalThis & { __postomat?: Promise<Handle> };

/**
 * One set of workflow deps per server process (survives Vite HMR). A failed
 * start (e.g. Postgres not up yet) is not cached, so the next request retries.
 */
function handle(): Promise<Handle> {
  g.__postomat ??= createDepsFromEnv('web').catch((e: unknown) => {
    g.__postomat = undefined;
    throw e;
  });
  return g.__postomat;
}

export async function getDeps(): Promise<WorkflowDeps> {
  return (await handle()).deps;
}

export async function getDbHandle() {
  return (await handle()).db;
}
