/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';

import pkg from './package.json' with { type: 'json' };

// Workspace packages are consumed from source via the "@postomat/source" export condition.
const conditions = ['@postomat/source', 'module', 'node', 'development|production'];
// They stay external in the SSR bundle: Node loads them (and their native deps such as
// sharp/resvg) itself – TS sources in dev (NODE_OPTIONS=--conditions=@postomat/source,
// see the serve target), built dist in production.
const workspacePackages = Object.keys(pkg.dependencies).filter((d) => d.startsWith('@postomat/'));

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  envDir: '../..',
  resolve: { conditions },
  ssr: {
    external: workspacePackages,
    resolve: { conditions, externalConditions: process.env.NODE_ENV === 'production' ? ['node'] : ['@postomat/source', 'node'] },
  },
  server: { port: 3000, host: 'localhost' },
  preview: { port: 3000, host: 'localhost' },
  plugins: [!process.env.VITEST && reactRouter(), tailwindcss(), nxReadySignal()],
  build: { outDir: './dist', emptyOutDir: true, reportCompressedSize: false },
  test: {
    name: 'web',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{app,tests}/**/*.{test,spec}.{ts,tsx}'],
    reporters: ['default'],
  },
}));
