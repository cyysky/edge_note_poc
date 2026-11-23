import { describe, expect, it } from 'vitest';

import { toHistoryMessage, toUserMessage } from './chat.service.js';

const png = { mimeType: 'image/png', data: 'AAAA' };
const wav = { mimeType: 'audio/wav', data: 'BBBB' };

describe('toUserMessage', () => {
  it('sends each attachment with the text derived from it', () => {
    const message = toUserMessage({
      role: 'user',
      text: 'what is this',
      images: [png],
      audio: [wav],
      derived: [{ text: 'A red circle.' }, { text: 'The quick brown fox.' }],
    });

    expect(message.content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'text', text: 'Image 1: A red circle.' },
      { type: 'audio', mimeType: 'audio/wav', data: 'BBBB' },
      { type: 'text', text: 'Audio 1: The quick brown fox.' },
    ]);
  });

  it('pairs a second attachment with its own entry, not the first one', () => {
    const message = toUserMessage({
      role: 'user',
      text: '',
      images: [png, png],
      derived: [{ text: 'First picture.' }, { text: 'Second picture.' }],
    });

    const parts = message.content as readonly { type: string; text?: string }[];
    const texts = parts.filter((part) => part.type === 'text').map((part) => part.text);
    expect(texts).toEqual(['Image 1: First picture.', 'Image 2: Second picture.']);
  });

  it('counts images before audio when both are attached', () => {
    const message = toUserMessage({
      role: 'user',
      text: '',
      images: [png],
      audio: [wav],
      derived: [{ text: 'A picture.' }, { text: 'A voice.' }],
    });

    const parts = message.content as readonly { type: string; text?: string }[];
    expect(parts.filter((part) => part.type === 'text').map((part) => part.text)).toEqual([
      'Image 1: A picture.',
      'Audio 1: A voice.',
    ]);
  });

  it('leaves a plain text turn as a string', () => {
    expect(toUserMessage({ role: 'user', text: 'hello' })).toEqual({
      role: 'user',
      content: 'hello',
    });
  });

  it('still sends the bytes when no text was derived', () => {
    const message = toUserMessage({ role: 'user', text: '', images: [png] });
    expect(message.content).toEqual([{ type: 'image', mimeType: 'image/png', data: 'AAAA' }]);
  });
});

describe('toHistoryMessage', () => {
  it('replays a caption as text, because the bytes are not resent', () => {
    expect(
      toHistoryMessage({
        role: 'user',
        text: 'what was that',
        derived: [{ text: 'A red circle.' }],
      }),
    ).toEqual({
      role: 'user',
      content: 'what was that\n\nAttachments in this message:\n- A red circle.',
    });
  });

  it('summarises attachments when the turn had no typed text', () => {
    expect(
      toHistoryMessage({ role: 'user', text: '   ', derived: [{ text: 'A short clip.' }] }),
    ).toEqual({
      role: 'user',
      content: 'Attachments in this message:\n- A short clip.',
    });
  });

  it('leaves an assistant turn untouched', () => {
    expect(
      toHistoryMessage({ role: 'assistant', text: 'Four notes.', derived: [{ text: 'ignored' }] }),
    ).toEqual({ role: 'assistant', content: 'Four notes.' });
  });
});
