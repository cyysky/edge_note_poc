import {
  CHAT_MAX_HISTORY,
  CHAT_MAX_MEDIA_BYTES,
  CHAT_MAX_MEDIA_PER_TURN,
  CHAT_MESSAGE_MAX,
  type ChatMedia,
  type ChatRequest,
  type ChatTurn,
} from './chat.js';
import type { FieldIssue } from './contracts.js';

export type ChatValidationResult =
  | { readonly ok: true; readonly value: ChatRequest }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

const DATA_URL_PREFIX = /^data:[^;]+;base64,/i;

function isMedia(value: unknown, path: string, issues: FieldIssue[]): value is ChatMedia {
  if (typeof value !== 'object' || value === null) {
    issues.push({ path, message: 'Expected a media object.' });
    return false;
  }
  const media = value as Record<string, unknown>;
  if (typeof media['mimeType'] !== 'string' || media['mimeType'].length === 0) {
    issues.push({ path: `${path}.mimeType`, message: 'MIME type is required.' });
    return false;
  }
  if (typeof media['data'] !== 'string' || media['data'].length === 0) {
    issues.push({ path: `${path}.data`, message: 'Base64 data is required.' });
    return false;
  }
  // Browsers hand over data URLs from FileReader; storing the prefix would
  // double it when the model client rebuilds `data:<mime>;base64,<payload>`.
  if (DATA_URL_PREFIX.test(media['data'])) {
    issues.push({
      path: `${path}.data`,
      message: 'Send base64 payloads without a data-URL prefix.',
    });
    return false;
  }
  const bytes = Math.floor((media['data'].length * 3) / 4);
  if (bytes > CHAT_MAX_MEDIA_BYTES) {
    issues.push({
      path: `${path}.data`,
      message: `Each file must be at most ${CHAT_MAX_MEDIA_BYTES / (1024 * 1024)} MB.`,
    });
    return false;
  }
  return true;
}

function mediaList(
  value: unknown,
  path: string,
  issues: FieldIssue[],
): readonly ChatMedia[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array.' });
    return undefined;
  }
  if (value.length > CHAT_MAX_MEDIA_PER_TURN) {
    issues.push({ path, message: `At most ${CHAT_MAX_MEDIA_PER_TURN} files per turn.` });
    return undefined;
  }
  const kept = value.filter((entry, index) => isMedia(entry, `${path}[${index}]`, issues));
  return kept.length === value.length ? (kept as ChatMedia[]) : undefined;
}

/**
 * Validate a chat request from the browser.
 *
 * Every turn is checked, not just the last one: a corrupted earlier turn would
 * still be replayed to the model on this request.
 */
export function validateChatRequest(input: unknown): ChatValidationResult {
  const issues: FieldIssue[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: 'Expected a JSON object.' }] };
  }

  const messages = (input as Record<string, unknown>)['messages'];
  if (!Array.isArray(messages)) {
    return { ok: false, issues: [{ path: 'messages', message: 'Expected an array.' }] };
  }
  if (messages.length === 0) {
    return {
      ok: false,
      issues: [{ path: 'messages', message: 'At least one message is required.' }],
    };
  }
  if (messages.length > CHAT_MAX_HISTORY) {
    issues.push({ path: 'messages', message: `At most ${CHAT_MAX_HISTORY} messages.` });
  }

  const turns: ChatTurn[] = [];
  messages.forEach((entry, index) => {
    const path = `messages[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push({ path, message: 'Expected an object.' });
      return;
    }
    const record = entry as Record<string, unknown>;
    const role = record['role'];
    const text = record['text'];

    if (role !== 'user' && role !== 'assistant') {
      issues.push({ path: `${path}.role`, message: 'Role must be user or assistant.' });
    }
    if (typeof text !== 'string') {
      issues.push({ path: `${path}.text`, message: 'Text must be a string.' });
    } else if (text.length > CHAT_MESSAGE_MAX) {
      issues.push({
        path: `${path}.text`,
        message: `Text must be at most ${CHAT_MESSAGE_MAX} characters.`,
      });
    }

    const images = mediaList(record['images'], `${path}.images`, issues);
    const audio = mediaList(record['audio'], `${path}.audio`, issues);

    if (role === 'assistant' && ((images?.length ?? 0) > 0 || (audio?.length ?? 0) > 0)) {
      issues.push({ path, message: 'Only user turns may carry media.' });
    }
    // Replayed turns are text only. The server already replays history that way,
    // and accepting media there would let a client post the same megabytes again
    // on every turn.
    if (index < messages.length - 1 && ((images?.length ?? 0) > 0 || (audio?.length ?? 0) > 0)) {
      issues.push({ path, message: 'Only the last message may carry media.' });
    }

    turns.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      text: typeof text === 'string' ? text : '',
      ...(images ? { images } : {}),
      ...(audio ? { audio } : {}),
    });
  });

  if (turns.length > 0 && turns.at(-1)?.role !== 'user') {
    issues.push({ path: 'messages', message: 'The last message must be from the user.' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { messages: turns } };
}
