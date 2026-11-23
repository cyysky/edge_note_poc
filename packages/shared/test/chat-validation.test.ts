import { describe, expect, it } from 'vitest';

import {
  CHAT_MAX_HISTORY,
  CHAT_MAX_MEDIA_BYTES,
  CHAT_MAX_MEDIA_PER_TURN,
  validateChatRequest,
  type ChatRequest,
} from '@displayer/shared';

const valid = (overrides: Record<string, unknown> = {}) => ({
  messages: [{ role: 'user', text: 'hello' }],
  ...overrides,
});

function expectIssues(input: unknown): readonly { path: string; message: string }[] {
  const result = validateChatRequest(input);
  if (result.ok) throw new Error('Expected validation to fail, but it passed.');
  return result.issues;
}

describe('validateChatRequest', () => {
  it('accepts a single text turn and returns the typed value', () => {
    const result = validateChatRequest(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages).toEqual([{ role: 'user', text: 'hello' }]);
  });

  it('accepts base64 media on a user turn and keeps it', () => {
    const result = validateChatRequest({
      messages: [
        {
          role: 'user',
          text: 'what is this',
          images: [{ mimeType: 'image/png', data: 'AAAA' }],
          audio: [{ mimeType: 'audio/wav', data: 'BBBB' }],
          derived: [{ text: 'A red circle.' }, { text: 'A short clip.' }],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages[0]?.images).toEqual([{ mimeType: 'image/png', data: 'AAAA' }]);
    expect(result.value.messages[0]?.audio).toEqual([{ mimeType: 'audio/wav', data: 'BBBB' }]);
  });

  it('rejects a data-URL payload so the prefix cannot be doubled', () => {
    const issues = expectIssues({
      messages: [
        {
          role: 'user',
          text: 'hi',
          images: [{ mimeType: 'image/png', data: 'data:image/png;base64,AAAA' }],
        },
      ],
    });

    expect(issues.map((issue) => issue.path)).toContain('messages[0].images[0].data');
  });

  it('rejects media on an assistant turn', () => {
    const issues = expectIssues({
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
      ],
    });

    expect(issues.some((issue) => issue.message.includes('Only user turns'))).toBe(true);
  });

  it('rejects media on an earlier turn so replays stay small', () => {
    const issues = expectIssues({
      messages: [
        { role: 'user', text: 'first', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
        { role: 'assistant', text: 'seen' },
        { role: 'user', text: 'second' },
      ],
    });

    expect(issues.some((issue) => issue.message.includes('Only the last message'))).toBe(true);
  });

  it('rejects more files in one turn than the per-turn cap', () => {
    const issues = expectIssues({
      messages: [
        {
          role: 'user',
          text: 'many',
          images: Array.from({ length: CHAT_MAX_MEDIA_PER_TURN + 1 }, () => ({
            mimeType: 'image/png',
            data: 'AAAA',
          })),
        },
      ],
    });

    expect(issues.map((issue) => issue.path)).toContain('messages[0].images');
  });

  it('rejects a file above the per-file ceiling', () => {
    // 4 base64 characters per 3 bytes, so this decodes to one byte over the cap.
    const oversized = 'A'.repeat(Math.ceil(((CHAT_MAX_MEDIA_BYTES + 1) * 4) / 3));
    const issues = expectIssues({
      messages: [
        {
          role: 'user',
          text: 'huge',
          audio: [{ mimeType: 'audio/wav', data: oversized }],
        },
      ],
    });

    expect(issues.some((issue) => issue.message.includes('at most 8 MB'))).toBe(true);
  });

  it('rejects an empty transcript', () => {
    expect(expectIssues(valid({ messages: [] })).map((issue) => issue.path)).toEqual(['messages']);
  });

  it('rejects a transcript that does not end with the user', () => {
    const issues = expectIssues({
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
      ],
    });

    expect(issues.some((issue) => issue.message.includes('last message'))).toBe(true);
  });

  it('rejects more history than the limit', () => {
    const messages = Array.from({ length: CHAT_MAX_HISTORY + 1 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: 'x',
    }));
    if (messages.length % 2 === 0) messages.push({ role: 'user', text: 'x' });

    const issues = expectIssues({ messages });
    expect(issues.some((issue) => issue.path === 'messages')).toBe(true);
  });

  it('rejects an unknown role', () => {
    const issues = expectIssues({ messages: [{ role: 'system', text: 'sneaky' }] });
    expect(issues.map((issue) => issue.path)).toContain('messages[0].role');
  });

  it('rejects a non-string body', () => {
    const issues = expectIssues({ messages: 'nope' });
    expect(issues[0]?.path).toBe('messages');
  });
});

describe('ChatRequest type', () => {
  it('round-trips through the validator unchanged', () => {
    const request: ChatRequest = {
      messages: [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'answer' },
        { role: 'user', text: 'second' },
      ],
    };

    const result = validateChatRequest(JSON.parse(JSON.stringify(request)));
    expect(result).toEqual({ ok: true, value: request });
  });
});

describe('derived text', () => {
  const withMedia = (extra: Record<string, unknown>) => ({
    messages: [
      {
        role: 'user',
        text: 'what is this',
        images: [{ mimeType: 'image/png', data: 'AAAA' }],
        ...extra,
      },
    ],
  });

  it('accepts one caption for one image', () => {
    const result = validateChatRequest(withMedia({ derived: [{ text: 'A red circle.' }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages[0]?.derived).toEqual([{ text: 'A red circle.' }]);
  });

  it('requires text for a turn that carries media', () => {
    const issues = expectIssues(withMedia({}));
    expect(issues[0]?.path).toBe('messages[0].derived');
  });

  it('rejects one caption short of the attachments', () => {
    const issues = expectIssues(
      withMedia({
        images: [
          { mimeType: 'image/png', data: 'AAAA' },
          { mimeType: 'image/png', data: 'BBBB' },
        ],
        derived: [{ text: 'Only one.' }],
      }),
    );
    expect(issues[0]?.message).toContain('one entry for each of the 2');
  });

  it('replays an earlier caption once its bytes are gone', () => {
    const result = validateChatRequest({
      messages: [
        {
          role: 'user',
          text: 'what did I show you?',
          derived: [{ text: 'The quick brown fox.' }],
        },
        { role: 'assistant', text: 'A recording.' },
        { role: 'user', text: 'thanks' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages[0]?.derived).toEqual([{ text: 'The quick brown fox.' }]);
  });

  it('rejects derived-only text on the last turn, which must include its media', () => {
    const issues = expectIssues({
      messages: [{ role: 'user', text: 'hi', derived: [{ text: 'A ghost caption.' }] }],
    });
    expect(issues[0]?.path).toBe('messages[0].derived');
  });

  it('rejects a blank caption, which would silently lose the attachment', () => {
    const issues = expectIssues(withMedia({ derived: [{ text: '   ' }] }));
    expect(issues[0]?.path).toBe('messages[0].derived[0].text');
  });

  it('drops unknown fields instead of echoing them back', () => {
    const result = validateChatRequest(withMedia({ derived: [{ text: 'Hola.', lanuage: 'es' }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.messages[0]?.derived?.[0]).toEqual({ text: 'Hola.' });
  });
});
