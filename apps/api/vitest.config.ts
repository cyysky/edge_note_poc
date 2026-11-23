import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * SWC is required: Nest's DI reads `design:paramtypes`, which only exists when
 * decorator metadata is emitted. esbuild (Vitest's default) does not emit it.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/**/*.e2e.test.ts'],
    environment: 'node',
  },
});
