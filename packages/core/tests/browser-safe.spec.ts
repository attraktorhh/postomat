import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Web routes import @postomat/core in the browser. A static `node:*` import makes
// the Vite dev server throw while loading the module, so the page never hydrates.
describe('@postomat/core is safe to import in the browser', () => {
  const src = join(import.meta.dirname, '../src');
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.ts'),
  );
  it.each(files)('%s has no runtime node:* import', (f) => {
    const code = readFileSync(join(src, f), 'utf8');
    expect(code).not.toMatch(/^import (?!type)[^;]*from 'node:/m);
  });
});
