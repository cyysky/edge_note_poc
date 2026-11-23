import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Tests import '@displayer/shared' like the apps do. Without this alias they
    // resolve to the last built dist/, so a source edit would silently not be
    // under test and a mutation could pass.
    alias: {
      '@displayer/shared': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
});
