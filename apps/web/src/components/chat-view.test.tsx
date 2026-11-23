import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatView } from './chat-view';

const sendChat = vi.fn();
const fetchSpeech = vi.fn();
const describeMedia = vi.fn();

vi.mock('@/lib/chat', () => ({
  sendChat: (messages: unknown) => sendChat(messages),
  fetchSpeech: (request: unknown) => fetchSpeech(request),
  describeMedia: (request: unknown) => describeMedia(request),
}));

/** A one-pixel PNG: enough for the real File -> base64 path. */
function pngFile(name = 'shot.png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
}

describe('ChatView', () => {
  beforeEach(() => {
    sendChat.mockReset();
    fetchSpeech.mockReset();
    describeMedia.mockReset();
    describeMedia.mockResolvedValue({ text: 'A red circle.' });
    URL.createObjectURL = vi.fn(() => 'blob:speech');
    URL.revokeObjectURL = vi.fn();
  });

  it('sends the typed message and renders the reply', async () => {
    sendChat.mockResolvedValue({ reply: 'One note.', tools: [], stopReason: 'final' });
    fetchSpeech.mockResolvedValue(new Blob(['wav']));
    const user = userEvent.setup();

    render(<ChatView />);

    await user.type(screen.getByLabelText('Message'), 'How many notes?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('One note.')).toBeInTheDocument());
    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(sendChat.mock.calls[0]?.[0]).toEqual([{ role: 'user', text: 'How many notes?' }]);
    expect(screen.getByText('How many notes?')).toBeInTheDocument();
  });

  it('keeps the text answer when speech synthesis fails', async () => {
    sendChat.mockResolvedValue({ reply: 'Text only.', tools: [], stopReason: 'final' });
    fetchSpeech.mockRejectedValue(new Error('speech down'));
    const user = userEvent.setup();

    render(<ChatView />);
    await user.type(screen.getByLabelText('Message'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Text only.')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error and keeps the typed message recoverable', async () => {
    sendChat.mockRejectedValue(new Error('The local model server is not running.'));
    const user = userEvent.setup();

    render(<ChatView />);
    await user.type(screen.getByLabelText('Message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not running'));
  });

  it('exposes tool calls in a details block', async () => {
    sendChat.mockResolvedValue({
      reply: 'Created it.',
      tools: [
        {
          name: 'create_note',
          arguments: '{"title":"Deck"}',
          ok: true,
          result: '{"created":{}}',
        },
      ],
      stopReason: 'final',
    });
    fetchSpeech.mockResolvedValue(new Blob(['wav']));
    const user = userEvent.setup();

    render(<ChatView />);
    await user.type(screen.getByLabelText('Message'), 'make a note');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Created it.')).toBeInTheDocument());
    expect(screen.getByText('1 tool call')).toBeInTheDocument();
    expect(screen.getByText('create_note')).toBeInTheDocument();
  });

  it('opens the camera dialog from the toolbar', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' })),
      },
    });
    const user = userEvent.setup();

    render(<ChatView />);
    await user.click(screen.getByRole('button', { name: 'Take photo' }));

    const dialog = screen.getByRole('dialog', { name: 'Take a photo' });
    expect(dialog).toHaveAttribute('open');
  });

  it('closes the microphone dialog on cancel', async () => {
    const user = userEvent.setup();

    render(<ChatView />);
    await user.click(screen.getByRole('button', { name: 'Record audio' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not send an empty message', async () => {
    const user = userEvent.setup();
    render(<ChatView />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('drops speech when the speak toggle is off', async () => {
    sendChat.mockResolvedValue({ reply: 'Silent.', tools: [], stopReason: 'final' });
    const user = userEvent.setup();

    render(<ChatView />);
    await user.click(screen.getByLabelText('Speak replies'));
    await user.type(screen.getByLabelText('Message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Silent.')).toBeInTheDocument());
    expect(fetchSpeech).not.toHaveBeenCalled();
  });
});

describe('ChatView media derivation', () => {
  it('shows the caption and sends it with the turn', async () => {
    describeMedia.mockResolvedValue({ text: 'A red circle on white.' });
    sendChat.mockResolvedValue({ reply: 'Got it.', tools: [], stopReason: 'final' });
    const user = userEvent.setup();

    const { container } = render(<ChatView />);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('image input not found');
    await user.upload(input, pngFile());

    expect(await screen.findByText('A red circle on white.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Message'), 'what is this');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    const sent = sendChat.mock.calls[0]?.[0] as {
      role: string;
      text: string;
      derived?: readonly { text: string }[];
    }[];
    expect(sent.at(-1)).toMatchObject({
      role: 'user',
      text: 'what is this',
      derived: [{ text: 'A red circle on white.' }],
    });
  });

  it('announces the finished caption through the one status region', async () => {
    describeMedia.mockResolvedValue({ text: 'A blue square.' });
    sendChat.mockResolvedValue({ reply: 'Got it.', tools: [], stopReason: 'final' });
    const user = userEvent.setup();

    const { container } = render(<ChatView />);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('image input not found');
    await user.upload(input, pngFile('square.png'));

    const status = screen.getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('Caption for square.png: A blue square.'));
    // One live region for the composer; the card must not be a second one.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('blocks sending until the caption exists', async () => {
    let finish: ((value: { text: string }) => void) | undefined;
    describeMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();

    const { container } = render(<ChatView />);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('image input not found');
    await user.upload(input, pngFile());

    const send = screen.getByRole('button', { name: 'Listening…' });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(sendChat).not.toHaveBeenCalled();

    // Ctrl+Enter reaches the handler without a click, so the button's disabled
    // state alone would not stop a turn that has no text for its attachment.
    await user.type(screen.getByLabelText('Message'), 'what is this');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(sendChat).not.toHaveBeenCalled();

    finish?.({ text: 'A tall tree.' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  });

  it('says when the caption failed instead of pretending it worked', async () => {
    describeMedia.mockRejectedValue(new Error('The model server is down.'));
    sendChat.mockResolvedValue({ reply: 'Got it.', tools: [], stopReason: 'final' });
    const user = userEvent.setup();

    const { container } = render(<ChatView />);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('image input not found');
    await user.upload(input, pngFile());

    expect(await screen.findByText('The model server is down.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message'), 'how many notes');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    // An undescribed file still sends; it just cannot claim any content.
    const sent = sendChat.mock.calls[0]?.[0] as { derived?: readonly { text: string }[] }[];
    expect(sent.at(-1)?.derived).toEqual([{ text: '' }]);
  });

  it('replays an earlier turn caption, since the bytes are not resent', async () => {
    describeMedia.mockResolvedValue({ text: 'A named caption.' });
    sendChat.mockResolvedValue({ reply: 'Got it.', tools: [], stopReason: 'final' });
    const user = userEvent.setup();

    const { container } = render(<ChatView />);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('image input not found');
    await user.upload(input, pngFile());
    await screen.findByText('A named caption.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText('Message'), 'and what was in it');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2));

    const second = sendChat.mock.calls[1]?.[0] as {
      role: string;
      images?: unknown;
      derived?: readonly { text: string }[];
    }[];
    const first = second[0];
    expect(first?.images).toBeUndefined();
    expect(first?.derived).toEqual([{ text: 'A named caption.' }]);
  });
});
