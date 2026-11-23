'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeMediaError, type RecorderErrorKind } from './audio-recorder';

export interface MediaError {
  readonly kind: RecorderErrorKind;
  readonly message: string;
}

export type StartResult =
  { readonly ok: true } | { readonly ok: false; readonly error: MediaError };

/**
 * One getUserMedia request, owned by a hook.
 *
 * The stream is released when the hook unmounts and on pagehide. Without the
 * second one, a phone that backgrounds the page can keep the camera light on
 * after the dialog is gone.
 */
export interface CameraState {
  readonly status: 'idle' | 'starting' | 'ready' | 'error';
  readonly error: MediaError | null;
  readonly previewRef: (element: HTMLVideoElement | null) => void;
  start(constraints: MediaStreamConstraints): Promise<StartResult>;
  stop(): void;
}

export function useCameraStream(): CameraState {
  const [status, setStatus] = useState<CameraState['status']>('idle');
  const [error, setError] = useState<MediaError | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Set on unmount: a getUserMedia that resolves afterwards must not keep the device. */
  const releasedRef = useRef(false);
  const elementRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    const element = elementRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (element) element.srcObject = null;
    // Unmount already discarded this state; updating it would be a no-op warning.
    if (!releasedRef.current) {
      setStatus('idle');
      setError(null);
    }
  }, []);

  const start = useCallback(async (constraints: MediaStreamConstraints): Promise<StartResult> => {
    setStatus('starting');
    setError(null);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('This browser cannot open a camera here.'), {
          name: 'NotSupportedError',
        });
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // The permission prompt can outlive the dialog: closing while it is up
      // unmounts the hook before this resolves. Stop what we just acquired
      // rather than storing it, or the camera light stays on with no owner.
      if (releasedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return { ok: false, error: describeMediaError({ name: 'AbortError' }) };
      }
      streamRef.current = stream;
      const element = elementRef.current;
      if (element) {
        element.srcObject = stream;
        // Autoplay is allowed for a muted stream, and the preview is not a
        // recording, so there is nothing to unmute.
        await element.play().catch(() => undefined);
      }
      setStatus('ready');
      return { ok: true };
    } catch (caught) {
      const described = describeMediaError(caught);
      // A dialog that is already gone must not schedule another render.
      if (!releasedRef.current) {
        setError(described);
        setStatus('error');
      }
      return { ok: false, error: described };
    }
  }, []);

  const previewRef = useCallback((element: HTMLVideoElement | null) => {
    elementRef.current = element;
    if (element && streamRef.current) {
      element.srcObject = streamRef.current;
      void element.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    releasedRef.current = false;
    const release = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    window.addEventListener('pagehide', release);
    return () => {
      releasedRef.current = true;
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  // Consumers destructure these, so identity does not need to be stable;
  // start and stop are already memoised.
  return { status, error, previewRef, start, stop };
}

/** Grab one still. The dialog preview is already showing what is captured. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return Promise.reject(new Error('The camera has not produced a picture yet.'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('This browser cannot capture a frame.'));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    // JPEG keeps a 1280x720 frame well under the 8 MB attachment ceiling.
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The frame could not be encoded.'))),
      'image/jpeg',
      0.9,
    );
  });
}
