import { describe, expect, it } from 'vitest';

import { NOTE_BODY_MAX, NOTE_TITLE_MAX, validateNoteInput } from '../src/index.js';

describe('validateNoteInput', () => {
  it('accepts a well-formed note and trims surrounding whitespace', () => {
    const result = validateNoteInput({ title: '  Hello  ', body: '  world  ' });

    expect(result).toEqual({ ok: true, value: { title: 'Hello', body: 'world' } });
  });

  it('allows an empty body', () => {
    const result = validateNoteInput({ title: 'Title only' });

    expect(result).toEqual({ ok: true, value: { title: 'Title only', body: '' } });
  });

  it('rejects non-object payloads', () => {
    for (const payload of [null, undefined, 'text', 42, ['a']]) {
      const result = validateNoteInput(payload);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a missing or blank title', () => {
    const missing = validateNoteInput({ body: 'x' });
    const blank = validateNoteInput({ title: '   ', body: 'x' });

    expect(missing).toEqual({
      ok: false,
      issues: [{ path: 'title', message: 'Title must be a string.' }],
    });
    expect(blank).toEqual({
      ok: false,
      issues: [{ path: 'title', message: 'Title is required.' }],
    });
  });

  it('rejects titles and bodies past their limits', () => {
    const longTitle = validateNoteInput({ title: 'a'.repeat(NOTE_TITLE_MAX + 1) });
    const longBody = validateNoteInput({
      title: 'ok',
      body: 'a'.repeat(NOTE_BODY_MAX + 1),
    });

    expect(longTitle.ok).toBe(false);
    expect(longBody.ok).toBe(false);
  });

  it('accepts values exactly at the limits', () => {
    const result = validateNoteInput({
      title: 'a'.repeat(NOTE_TITLE_MAX),
      body: 'b'.repeat(NOTE_BODY_MAX),
    });

    expect(result.ok).toBe(true);
  });

  it('reports every issue at once', () => {
    const result = validateNoteInput({ title: '', body: 123 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(['body', 'title']);
    }
  });
});
