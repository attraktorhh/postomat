import './env-load.server';
import { createDepsFromEnv, type WorkflowDeps } from '@postomat/workflow';

type Handle = Awaited<ReturnType<typeof createDepsFromEnv>>;
const g = globalThis as typeof globalThis & { __postomat?: Promise<Handle> };

/** One set of workflow deps per server process (survives Vite HMR). */
export async function getDeps(): Promise<WorkflowDeps> {
  g.__postomat ??= createDepsFromEnv('web');
  return (await g.__postomat).deps;
}

export async function getDbHandle() {
  g.__postomat ??= createDepsFromEnv('web');
  return (await g.__postomat).db;
}
