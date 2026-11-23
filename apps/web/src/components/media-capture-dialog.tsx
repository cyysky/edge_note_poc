'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  RECORDER_MAX_SECONDS,
  describeMediaError,
  formatSeconds,
  startRecording,
  type AudioRecorder,
} from '@/lib/audio-recorder';
import { captureFrame, useCameraStream } from '@/lib/use-camera-stream';

export type CaptureKind = 'camera' | 'microphone';

export interface CapturedMedia {
  readonly file: File;
  readonly kind: CaptureKind;
}

interface MediaCaptureDialogProps {
  readonly kind: CaptureKind;
  readonly onCapture: (media: CapturedMedia) => void;
  readonly onClose: () => void;
}

/** A clip shorter than this is almost always a mis-click. */
const MIN_RECORDING_SECONDS = 0.3;

/**
 * Native dialog for grabbing one picture or one audio clip.
 *
 * The component is only mounted while the dialog is open, so mounting is the
 * same event as opening: fresh state, no reset effect, and unmounting always
 * releases the device. showModal() supplies the top layer, background
 * inertness, focus return and Esc.
 */
export function MediaCaptureDialog({ kind, onCapture, onClose }: MediaCaptureDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const {
    status,
    error: cameraError,
    previewRef,
    start: startCamera,
    stop: stopCamera,
  } = useCameraStream();
  const [error, setError] = useState<string | null>(null);
  // Soft feedback: the dialog stays usable, so this is not an alert.
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);

  const recorderRef = useRef<AudioRecorder | null>(null);
  /** Aborts a microphone start that is still waiting on the permission prompt. */
  const startAbortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const finishingRef = useRef(false);

  const baseId = useId();
  const titleId = baseId + '-title';
  const hintId = baseId + '-hint';

  const release = useCallback(() => {
    stopCamera();
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, [stopCamera]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Releasing on unmount covers every close path, including a parent that
  // drops us without calling close().
  useEffect(() => release, [release]);

  /**
   * Closing is what returns focus to the button that opened the dialog; the
   * parent then unmounts us, and the unmount effect releases the device.
   */
  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose();
  }, [onClose]);

  const beginRecording = useCallback(async () => {
    const abort = new AbortController();
    startAbortRef.current = abort;
    try {
      const recorder = await startRecording({ signal: abort.signal });
      // The dialog may have closed while the prompt was up; the recorder could
      // be holding a live microphone nobody will ever stop.
      if (abort.signal.aborted) {
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
    } catch (caught) {
      if (!abort.signal.aborted) setError(describeMediaError(caught).message);
    } finally {
      if (startAbortRef.current === abort) startAbortRef.current = null;
    }
  }, []);

  const finishMicrophone = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || finishingRef.current) return;
    finishingRef.current = true;
    setBusy(true);
    try {
      const clip = await recorder.stop();
      recorderRef.current = null;
      setRecording(false);
      if (clip.seconds < MIN_RECORDING_SECONDS) {
        // Nothing usable was captured, so stay open and start over rather than
        // stranding the person in a dialog whose recorder is already closed.
        setNotice('That recording was too short. Try again and speak a little longer.');
        setBusy(false);
        await beginRecording();
        return;
      }
      const file = new File([clip.wav], clip.name, { type: 'audio/wav' });
      onCapture({ file, kind: 'microphone' });
      close();
    } catch {
      setError('The recording could not be saved.');
      setBusy(false);
    } finally {
      finishingRef.current = false;
    }
  }, [beginRecording, close, onCapture]);

  // Opening this dialog is asking for the device; closing it gives it back.
  // The start is deferred by a task so the dialog paints before a permission
  // prompt can cover it, and so the request is not made during a render pass.
  useEffect(() => {
    if (kind === 'camera') {
      void startCamera({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      return;
    }
    const timer = window.setTimeout(() => void beginRecording(), 0);
    return () => window.clearTimeout(timer);
  }, [kind, beginRecording, startCamera]);

  // Elapsed clock, and an automatic stop at the guard rail.
  useEffect(() => {
    if (!recording) return;
    const tick = window.setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(seconds);
      if (seconds >= RECORDER_MAX_SECONDS) void finishMicrophone();
    }, 250);
    return () => window.clearInterval(tick);
  }, [recording, finishMicrophone]);

  const takePhoto = useCallback(async () => {
    const video = dialogRef.current?.querySelector('video');
    if (!video) return;
    setBusy(true);
    try {
      const blob = await captureFrame(video);
      const file = new File([blob], 'Camera photo ' + new Date().toLocaleTimeString() + '.jpg', {
        type: 'image/jpeg',
      });
      onCapture({ file, kind: 'camera' });
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The photo could not be captured.');
    } finally {
      setBusy(false);
    }
  }, [close, onCapture]);

  const isCamera = kind === 'camera';
  const title = isCamera ? 'Take a photo' : 'Record audio';
  // A getUserMedia rejection lives in the hook; a capture failure lives here.
  const shownError = error ?? cameraError?.message ?? null;
  const canCapture = isCamera
    ? status === 'ready' && !shownError && !busy
    : recording && !shownError && !busy;

  return (
    <dialog
      ref={dialogRef}
      className="capture-dialog"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(event) => {
        // Esc: take over so we close through our own state, which also
        // releases the device on unmount.
        event.preventDefault();
        close();
      }}
      // A browser-initiated close (form method="dialog") still has to reach
      // the parent, otherwise the dialog would be hidden but stay mounted.
      onClose={() => onClose()}
    >
      <div className="dialog-form">
        <header className="dialog-header">
          <h3 id={titleId}>{title}</h3>
          <p id={hintId}>
            {isCamera
              ? 'The preview stays on this machine. Nothing is stored until you attach the photo.'
              : 'Up to ' + formatSeconds(RECORDER_MAX_SECONDS) + '. The clip is saved as WAV.'}
          </p>
        </header>

        {shownError ? (
          <div className="alert" role="alert">
            <strong>{isCamera ? 'The camera is unavailable.' : 'Recording failed.'}</strong>
            <p className="alert-message">{shownError}</p>
          </div>
        ) : null}

        {isCamera ? (
          <div className="capture-stage">
            <video
              ref={previewRef}
              className="capture-video"
              muted
              playsInline
              aria-label="Camera preview"
            />
            {status === 'starting' && !shownError ? (
              <p className="capture-status" role="status">
                Waiting for the camera…
              </p>
            ) : null}
          </div>
        ) : (
          <div className="capture-stage capture-stage--audio">
            <p className="capture-timer">{shownError ? '—' : formatSeconds(elapsed)}</p>
            <p className="hint" role="status">
              {shownError
                ? 'Nothing is being recorded.'
                : notice
                  ? notice
                  : recording
                    ? 'Recording. Attach it when you have said what you need.'
                    : 'Waiting for the microphone…'}
            </p>
          </div>
        )}

        <div className="capture-actions">
          <button type="button" className="button button--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => (isCamera ? void takePhoto() : void finishMicrophone())}
            disabled={!canCapture}
            autoFocus
          >
            {isCamera ? (busy ? 'Capturing…' : 'Take photo') : busy ? 'Saving…' : 'Stop and attach'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
