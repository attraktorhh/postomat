import type * as Fs from 'node:fs';
import type * as Path from 'node:path';

// Node modules are loaded lazily: web routes import @postomat/core in the browser,
// where a static node:* import makes the Vite dev server throw on load (no hydration).
export const nodeFs = () => process.getBuiltinModule('node:fs') as typeof Fs;
const nodePath = () => process.getBuiltinModule('node:path') as typeof Path;

/** The monorepo root (folder with pnpm-workspace.yaml), or the cwd. */
export function workspaceRoot(start = process.cwd()): string {
  const { existsSync } = nodeFs();
  const { dirname, join, resolve } = nodePath();
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Resolves a relative path against the workspace root (apps may run with another cwd). */
export const fromRoot = (path: string): string =>
  nodePath().isAbsolute(path)
    ? path
    : nodePath().resolve(workspaceRoot(), path);

/** Loads <root>/.env if it exists; real environment variables win. */
export function loadRootEnvFile(): void {
  const file = nodePath().join(workspaceRoot(), '.env');
  if (!nodeFs().existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}
