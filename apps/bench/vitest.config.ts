import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Source, not stale `dist`: a test that reads a previous build can pass
      // while the code under test is broken.
      '@displayer/agent': fileURLToPath(
        new URL('../../packages/agent/src/index.ts', import.meta.url),
      ),
      '@displayer/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
