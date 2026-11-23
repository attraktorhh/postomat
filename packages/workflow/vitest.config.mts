import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/workflow',
  resolve: { conditions: ['@postomat/source', 'module', 'node', 'development|production'] },
  ssr: { resolve: { conditions: ['@postomat/source', 'module', 'node', 'development|production'] } },
  test: {
    name: 'workflow',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
