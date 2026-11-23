import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** The monorepo root (folder with pnpm-workspace.yaml), or the cwd. */
export function workspaceRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Resolves a relative path against the workspace root (apps may run with another cwd). */
export const fromRoot = (path: string): string => (isAbsolute(path) ? path : resolve(workspaceRoot(), path));

/** Loads <root>/.env if it exists; real environment variables win. */
export function loadRootEnvFile(): void {
  const file = join(workspaceRoot(), '.env');
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}
