import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatView } from './chat-view';

const sendChat = vi.fn();
const fetchSpeech = vi.fn();

vi.mock('@/lib/chat', () => ({
  sendChat: (messages: unknown) => sendChat(messages),
  fetchSpeech: (request: unknown) => fetchSpeech(request),
}));

describe('ChatView', () => {
  beforeEach(() => {
    sendChat.mockReset();
    fetchSpeech.mockReset();
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
