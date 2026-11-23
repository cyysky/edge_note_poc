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

    // body-parser rejects oversized bodies with a plain http-errors object, not
    // an HttpException. Without this the client would see a 500 and assume the
    // server broke rather than that the upload was too big.
    const parserFailure = asBodyParserError(exception);
    if (parserFailure) {
      const body: ApiErrorResponse = {
        error: { code: ERROR_CODES.payloadTooLarge, message: parserFailure.message },
      };
      response.status(parserFailure.status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      const body: ApiErrorResponse = {
        error: {
          code: codeForStatus(status),
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

function codeForStatus(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return ERROR_CODES.notFound;
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) return ERROR_CODES.payloadTooLarge;
  return ERROR_CODES.validationFailed;
}

function asBodyParserError(
  exception: unknown,
): { readonly status: number; readonly message: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { status?: unknown; type?: unknown; message?: unknown };
  if (typeof candidate.status !== 'number' || candidate.status < 400 || candidate.status > 499) {
    return null;
  }
  // `type` is body-parser's own taxonomy: entity.too.large, encoding.unsupported,
  // etc. Only trust it when the message is present too, so an arbitrary thrown
  // object with a `status` field cannot masquerade as a client error.
  if (typeof candidate.type !== 'string' || typeof candidate.message !== 'string') return null;
  return {
    status: candidate.status,
    message: candidate.message,
  };
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
