import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or a transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(url: string, max = 10): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(db: Database, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder });
}
