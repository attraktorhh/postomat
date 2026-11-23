/** CLI: applies all migrations to DATABASE_URL. Used by `nx run db:migrate` and on deploy. */
import { createDb, runMigrations } from './client.ts';

const url = process.env.DATABASE_URL ?? 'postgres://postomat:postomat@localhost:55432/postomat';
const handle = createDb(url, 1);
try {
  await runMigrations(handle.db);
  console.log(`migrations applied to ${url.replace(/:[^:@/]+@/, ':***@')}`);
} finally {
  await handle.close();
}
