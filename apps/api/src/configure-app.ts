import type { NestExpressApplication } from '@nestjs/platform-express';

import { CHAT_MAX_BODY_BYTES } from '@displayer/shared';

import { ApiExceptionFilter } from './common/api-exception.filter.js';

/**
 * HTTP configuration shared by `main.ts` and the e2e tests, so tests exercise
 * exactly the pipeline production runs.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  // Nest's default 100 kB JSON limit silently predates chat attachments: an
  // 88 kB WAV arrives as ~118 kB of base64 and was rejected by the transport
  // before validation could explain why. Size the parser from the contract so
  // anything the contract permits is actually deliverable.
  app.useBodyParser('json', { limit: CHAT_MAX_BODY_BYTES });
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
