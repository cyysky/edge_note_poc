import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Resolve the workspace package to source so a test can never pass against
    // stale dist output while the source it claims to cover has changed.
    alias: {
      '@displayer/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
