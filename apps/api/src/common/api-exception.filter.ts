import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { ERROR_CODES, type ApiErrorResponse } from '@displayer/shared';

/**
 * Convert any thrown value into the single error shape the client knows how to
 * read, so the UI never has to special-case framework error formats.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      const body: ApiErrorResponse = {
        error: {
          code:
            status === HttpStatus.NOT_FOUND ? ERROR_CODES.notFound : ERROR_CODES.validationFailed,
          message: extractMessage(payload, exception.message),
          ...(Array.isArray((payload as { details?: unknown }).details)
            ? { details: (payload as { details: ApiErrorResponse['error']['details'] }).details }
            : {}),
        },
      };

      response.status(status).json(body);
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    const body: ApiErrorResponse = {
      error: { code: ERROR_CODES.internal, message: 'Unexpected server error.' },
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return fallback;
}
