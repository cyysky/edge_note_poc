import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioRecorder, startRecording as StartRecording } from '@/lib/audio-recorder';

import { MediaCaptureDialog } from './media-capture-dialog';

const startRecording = vi.fn();

vi.mock('@/lib/audio-recorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audio-recorder')>();
  return {
    ...actual,
    startRecording: (...args: Parameters<typeof actual.startRecording>) => startRecording(...args),
  };
});

function fakeStream(): MediaStream {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }], getAudioTracks: () => [] } as unknown as MediaStream;
}

/** jsdom has no media pipeline: give the preview frames and a working encoder. */
function stubMediaApis() {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 720,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
    callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });
}

describe('MediaCaptureDialog', () => {
  beforeEach(() => {
    startRecording.mockReset();
    stubMediaApis();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('explains a denied camera permission instead of leaving a dead preview', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      },
    });

    render(<MediaCaptureDialog kind="camera" onCapture={vi.fn()} onClose={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('permission was denied');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
  });

  it('hands the captured frame over as a JPEG file', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream()) },
    });
    const onCapture = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MediaCaptureDialog kind="camera" onCapture={onCapture} onClose={onClose} />);

    const shutter = screen.getByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
    await user.click(shutter);

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    const captured = onCapture.mock.calls[0]?.[0] as { file: File; kind: string };
    expect(captured.kind).toBe('camera');
    expect(captured.file.type).toBe('image/jpeg');
    expect(onClose).toHaveBeenCalled();
  });

  it('attaches a finished recording as a WAV file', async () => {
    startRecording.mockResolvedValue({
      lost: false,
      cancel: vi.fn(),
      stop: vi.fn().mockResolvedValue({
        wav: new Blob(['RIFF'], { type: 'audio/wav' }),
        seconds: 1.4,
        name: 'Microphone recording, 0:01',
      }),
    });
    const onCapture = vi.fn();
    const user = userEvent.setup();

    render(<MediaCaptureDialog kind="microphone" onCapture={onCapture} onClose={vi.fn()} />);

    const stop = await screen.findByRole('button', { name: 'Stop and attach' });
    await waitFor(() => expect(stop).toBeEnabled());
    await user.click(stop);

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    const captured = onCapture.mock.calls[0]?.[0] as { file: File; kind: string };
    expect(captured.kind).toBe('microphone');
    expect(captured.file.type).toBe('audio/wav');
  });

  it('surfaces a failed microphone start', async () => {
    startRecording.mockRejectedValue(
      Object.assign(new Error('busy'), { name: 'NotReadableError' }),
    );

    render(<MediaCaptureDialog kind="microphone" onCapture={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('busy in another app');
  });
});
describe('MediaCaptureDialog closing during a permission prompt', () => {
  it('stops a camera stream that arrives after the dialog closed', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const stop = vi.fn();

    const { unmount } = render(
      <MediaCaptureDialog kind="camera" onCapture={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    unmount();

    resolveStream?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('aborts and discards a recording that starts after the dialog closed', async () => {
    let resolveRecorder: ((recorder: AudioRecorder) => void) | undefined;
    let options: Parameters<typeof StartRecording>[0];
    startRecording.mockImplementation((received) => {
      options = received;
      return new Promise((resolve) => {
        resolveRecorder = resolve;
      });
    });
    const cancel = vi.fn();

    const { unmount } = render(
      <MediaCaptureDialog kind="microphone" onCapture={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(options?.signal).toBeDefined());
    unmount();

    expect(options?.signal?.aborted).toBe(true);
    resolveRecorder?.({ lost: false, cancel, stop: vi.fn() });

    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
