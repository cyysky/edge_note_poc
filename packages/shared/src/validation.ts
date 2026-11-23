import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type FieldIssue, type NoteInput } from './contracts.js';

export type ValidationResult =
  | { readonly ok: true; readonly value: NoteInput }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

/**
 * Validate a note payload from an untrusted client.
 *
 * Returns trimmed values so storage and reads agree on whitespace, and reports
 * every issue at once rather than failing on the first one.
 */
export function validateNoteInput(input: unknown): ValidationResult {
  const issues: FieldIssue[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'Expected a JSON object.' }],
    };
  }

  const record = input as Record<string, unknown>;
  const rawTitle = record['title'];
  const rawBody = record['body'];

  if (typeof rawTitle !== 'string') {
    issues.push({ path: 'title', message: 'Title must be a string.' });
  }
  // `body` is optional: an omitted body means "no body", not a bad body.
  if (rawBody !== undefined && typeof rawBody !== 'string') {
    issues.push({ path: 'body', message: 'Body must be a string.' });
  }

  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';

  if (typeof rawTitle === 'string') {
    if (title.length === 0) {
      issues.push({ path: 'title', message: 'Title is required.' });
    } else if (title.length > NOTE_TITLE_MAX) {
      issues.push({
        path: 'title',
        message: `Title must be at most ${NOTE_TITLE_MAX} characters.`,
      });
    }
  }

  if (typeof rawBody === 'string' && body.length > NOTE_BODY_MAX) {
    issues.push({
      path: 'body',
      message: `Body must be at most ${NOTE_BODY_MAX} characters.`,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { title, body } };
}
