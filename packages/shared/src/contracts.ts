/**
 * Wire contracts shared by the API and the web client.
 *
 * These are the single source of truth for request/response shapes. Both sides
 * import them, so a field rename becomes a compile error rather than a runtime
 * mismatch.
 */

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 5_000;

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** ISO-8601 instant, always UTC. */
  readonly createdAt: string;
  /** ISO-8601 instant, always UTC. */
  readonly updatedAt: string;
}

export interface NoteInput {
  readonly title: string;
  readonly body: string;
}

export interface NoteListResponse {
  readonly items: readonly Note[];
}

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly FieldIssue[];
  };
}

export const ERROR_CODES = {
  validationFailed: 'VALIDATION_FAILED',
  notFound: 'NOT_FOUND',
  /** The request body was larger than the API will parse. */
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
