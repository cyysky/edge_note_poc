import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3001;
/** Private port: a stub must never collide with a real llama-server on 8080. */
const MODEL_PORT = 8181;
const WEB_PORT = 3100;

/** A unique database per run keeps one run from inheriting another's notes. */
const databasePath = fileURLToPath(
  new URL(`./e2e-data/playwright-${Date.now()}.db`, import.meta.url),
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // A deterministic stand-in for llama-server. The real model is a
      // multi-gigabyte GPU download; what this suite asserts is the chat path,
      // not model quality (that is `pnpm bench`).
      command: 'node e2e/fixtures/model-stub.mjs',
      url: `http://127.0.0.1:${MODEL_PORT}/health`,
      cwd: '.',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { STUB_MODEL_PORT: String(MODEL_PORT) },
    },
    {
      command: 'pnpm --filter @displayer/api start',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_PATH: databasePath,
        MODEL_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
        NOTES_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
    {
      // The API origin is compiled into the Next build, so the API keeps its
      // default port and the browser reaches it through the `/api` rewrite.
      command: 'pnpm --filter @displayer/web start',
      url: `http://127.0.0.1:${WEB_PORT}`,
      cwd: '../..',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(WEB_PORT),
      },
    },
  ],
});
