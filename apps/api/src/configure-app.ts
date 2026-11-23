import type { INestApplication } from '@nestjs/common';

import { ApiExceptionFilter } from './common/api-exception.filter.js';

/**
 * HTTP configuration shared by `main.ts` and the e2e tests, so tests exercise
 * exactly the pipeline production runs.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  // The browser normally reaches the API through the Next rewrite, so CORS is
  // only needed for direct cross-origin calls (tools, alternate dev ports).
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || isLoopbackOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
  });
  app.enableShutdownHooks();
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      /^(127\.0\.0\.1|localhost|\[::1\])$/.test(hostname)
    );
  } catch {
    return false;
  }
}
