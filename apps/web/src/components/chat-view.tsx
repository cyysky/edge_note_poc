'use client';

import { useCallback, useId, useRef, useState } from 'react';

import {
  CHAT_MAX_MEDIA_BYTES,
  type ChatDerivation,
  type ChatMedia,
  type ChatToolTrace,
  type ChatTurn,
} from '@displayer/shared';

import { describeMedia, fetchSpeech, sendChat } from '@/lib/chat';

import { MediaCaptureDialog, type CaptureKind, type CapturedMedia } from './media-capture-dialog';

const AUDIO_ACCEPT = 'audio/*';
const IMAGE_ACCEPT = 'image/*';
/** Same ceiling the API enforces, so the picker never accepts a doomed file. */
const MAX_FILE_BYTES = CHAT_MAX_MEDIA_BYTES;

type Derivation =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed'; readonly message: string };

interface PendingMedia {
  readonly id: string;
  readonly kind: 'image' | 'audio';
  readonly name: string;
  readonly media: ChatMedia;
  readonly url: string;
  /** Caption or transcript, derived once when the file is attached. */
  readonly derivation: Derivation;
}

interface TranscriptEntry {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly tools: readonly ChatToolTrace[];
  readonly media: readonly PendingMedia[];
  /** The English text the model derived from this turn's attachments. */
  readonly derived: readonly string[];
  /** Object URL for the spoken reply, when the user asked for audio. */
  readonly speechUrl?: string;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'speaking' }
  | { readonly kind: 'error'; readonly message: string };

let nextId = 0;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function readAsBase64(file: File): Promise<ChatMedia> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(`${file.name} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      const comma = result.indexOf(',');
      resolve({ mimeType: file.type, data: result.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  });
}

export function ChatView() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingMedia[]>([]);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** Which capture dialog is open; at most one device is ever live. */
  const [capture, setCapture] = useState<CaptureKind | null>(null);
  /**
   * The last caption or transcript that settled, announced through the
   * composer's single status region.
   *
   * The guidance is one polite region per page, and a region that appears
   * already populated is not reliably announced — so this text only changes an
   * element that is always present. Each card stays plain text, readable on
   * demand, and a new notice replaces the old one rather than repeating it.
   */
  const [derivedNotice, setDerivedNotice] = useState<{
    readonly id: string;
    readonly text: string;
  } | null>(null);

  const formId = useId();
  const messageId = `${formId}-message`;
  const attachHintId = `${formId}-attach-hint`;
  const transcriptRef = useRef<HTMLOListElement>(null);

  const busy = status.kind === 'sending' || status.kind === 'speaking';
  /**
   * Sending before the caption exists would drop what the attachment says: the
   * server only ever replays text, and the bytes are gone from the next request.
   */
  const deriving = attachments.some((item) => item.derivation.status === 'pending');

  const updateDerivation = useCallback((id: string, derivation: Derivation) => {
    setAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, derivation } : item)),
    );
  }, []);

  const announceDerivation = useCallback((id: string, text: string) => {
    setDerivedNotice({ id, text });
  }, []);

  /**
   * Derive the caption or transcript as soon as the file is attached.
   *
   * Doing it here, not at send time, is what makes the text visible before it
   * becomes part of the conversation: the person can see what the model heard
   * or saw while the attachment is still removable.
   */
  const derive = useCallback(
    async (id: string, media: ChatMedia, kind: 'image' | 'audio', name: string) => {
      const label = kind === 'image' ? 'Caption' : 'Transcript';
      try {
        const response = await describeMedia({ media, kind });
        updateDerivation(id, {
          status: 'ready',
          text: response.text,
        });
        announceDerivation(id, label + ' for ' + name + ': ' + response.text);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'The text for that attachment could not be derived.';
        updateDerivation(id, { status: 'failed', message });
        announceDerivation(id, label + ' for ' + name + ' failed: ' + message);
      }
      // updateDerivation is the only way to settle this entry, so it belongs here.
    },
    [announceDerivation, updateDerivation],
  );

  const acceptFiles = useCallback(
    async (files: readonly File[], kind: 'image' | 'audio') => {
      if (files.length === 0) return;
      try {
        const loaded = await Promise.all(
          files.map(async (file) => {
            const media = await readAsBase64(file);
            return {
              id: makeId(kind),
              kind,
              name: file.name,
              media,
              url: URL.createObjectURL(file),
              derivation: { status: 'pending' },
            } satisfies PendingMedia;
          }),
        );
        setAttachments((current) => [...current, ...loaded]);
        setStatus({ kind: 'idle' });
        for (const item of loaded) void derive(item.id, item.media, item.kind, item.name);
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not attach that file.',
        });
      }
    },
    [derive],
  );

  const addFiles = useCallback(
    async (files: FileList | null, kind: 'image' | 'audio') => {
      if (!files) return;
      await acceptFiles(Array.from(files), kind);
    },
    [acceptFiles],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
    setDerivedNotice((current) => (current?.id === id ? null : current));
  }, []);

  /**
   * A capture and a file picker end in the same place: one File read to base64,
   * shown in the attachment list and described like any other file.
   */
  const addCaptured = useCallback(
    (captured: CapturedMedia) => {
      void acceptFiles([captured.file], captured.kind === 'camera' ? 'image' : 'audio');
    },
    [acceptFiles],
  );

  const scrollToLatest = useCallback(() => {
    const list = transcriptRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = draft.trim();
      if (busy || deriving) return;
      if (text.length === 0 && attachments.length === 0) return;

      const derived = attachments.map((item) =>
        item.derivation.status === 'ready' ? item.derivation.text : '',
      );
      const userEntry: TranscriptEntry = {
        id: makeId('user'),
        role: 'user',
        text,
        tools: [],
        media: attachments,
        derived,
      };
      const history: ChatTurn[] = [
        ...entries.map((entry) => ({
          role: entry.role,
          text: entry.text,
          ...(entry.derived.length > 0
            ? { derived: entry.derived.map((line) => ({ text: line })) }
            : {}),
        })),
        {
          role: 'user',
          text,
          ...(attachments.some((item) => item.kind === 'image')
            ? {
                images: attachments
                  .filter((item) => item.kind === 'image')
                  .map((item) => item.media),
              }
            : {}),
          ...(attachments.some((item) => item.kind === 'audio')
            ? {
                audio: attachments
                  .filter((item) => item.kind === 'audio')
                  .map((item) => item.media),
              }
            : {}),
          ...(derived.length > 0
            ? { derived: derived.map((line): ChatDerivation => ({ text: line })) }
            : {}),
        },
      ];

      setEntries((current) => [...current, userEntry]);
      setDraft('');
      setAttachments([]);
      setStatus({ kind: 'sending' });

      try {
        const response = await sendChat(history);
        let speechUrl: string | undefined;
        if (speakReplies && response.reply.trim().length > 0) {
          setStatus({ kind: 'speaking' });
          try {
            const blob = await fetchSpeech({ text: response.reply, format: 'wav' });
            speechUrl = URL.createObjectURL(blob);
          } catch {
            // Speech is an enhancement; a failed synthesis must not hide the text.
            speechUrl = undefined;
          }
        }

        setEntries((current) => [
          ...current,
          {
            id: makeId('assistant'),
            role: 'assistant',
            text:
              response.reply ||
              (response.stopReason === 'steps'
                ? 'I stopped after several tool calls without a final answer.'
                : ''),
            tools: response.tools,
            media: [],
            derived: [],
            ...(speechUrl ? { speechUrl } : {}),
          },
        ]);
        setStatus({ kind: 'idle' });
        queueMicrotask(scrollToLatest);
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'The assistant could not answer.',
        });
      }
    },
    [attachments, busy, deriving, draft, entries, scrollToLatest, speakReplies],
  );

  return (
    <section className="chat" aria-labelledby="chat-heading">
      <h2 id="chat-heading" className="visually-hidden">
        Conversation
      </h2>

      <ol className="chat-log" ref={transcriptRef} aria-live="polite" aria-relevant="additions">
        {entries.length === 0 ? (
          <li className="chat-empty">
            Ask about your notes, or attach a picture or a recording. The model runs on this
            machine.
          </li>
        ) : null}
        {entries.map((entry) => (
          <li key={entry.id} className={`chat-turn chat-turn--${entry.role}`}>
            <p className="chat-role">{entry.role === 'user' ? 'You' : 'LFM3-Omni'}</p>
            {entry.media.length > 0 ? (
              <ul className="chat-media">
                {entry.media.map((item) =>
                  item.kind === 'image' ? (
                    <li key={item.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.name} width={160} height={120} />
                    </li>
                  ) : (
                    <li key={item.id}>
                      <audio src={item.url} controls preload="metadata" />
                      <span className="chat-file-name">{item.name}</span>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
            {entry.derived.length > 0 ? (
              <ul className="chat-derived">
                {entry.derived.map((line, index) => (
                  <li key={`${entry.id}-derived-${index}`}>{line}</li>
                ))}
              </ul>
            ) : null}
            {entry.text.length > 0 ? <p className="chat-text">{entry.text}</p> : null}
            {entry.tools.length > 0 ? (
              <details className="chat-tools">
                <summary>
                  {entry.tools.length} tool {entry.tools.length === 1 ? 'call' : 'calls'}
                </summary>
                <ul>
                  {entry.tools.map((tool, index) => (
                    <li key={`${entry.id}-tool-${index}`}>
                      <code>{tool.name}</code> {tool.ok ? 'ok' : 'failed'}
                      <pre>{tool.arguments}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {entry.speechUrl ? (
              <audio className="chat-speech" src={entry.speechUrl} controls preload="metadata" />
            ) : null}
          </li>
        ))}
      </ol>

      {status.kind === 'error' ? (
        <div className="alert" role="alert">
          <strong>The assistant could not answer.</strong>
          <p className="alert-message">{status.message}</p>
        </div>
      ) : null}

      <form
        className="chat-form"
        onSubmit={(event) => void handleSubmit(event)}
        aria-labelledby="chat-heading"
      >
        <div className="field">
          <label htmlFor={messageId}>Message</label>
          <textarea
            id={messageId}
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
            aria-describedby={attachHintId}
            placeholder="Ask about your notes…"
          />
          <span className="hint" id={attachHintId}>
            Ctrl+Enter sends. A photo is captioned and a recording is transcribed, both in English,
            before you send.
          </span>
        </div>

        {attachments.length > 0 ? (
          <ul className="chat-attachments">
            {attachments.map((item) => (
              <li key={item.id} className="chat-attachment">
                <div className="chat-attachment-head">
                  <span>{item.name}</span>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => removeAttachment(item.id)}
                    aria-label={`Remove ${item.name}`}
                  >
                    Remove
                  </button>
                </div>
                <p className="chat-derived-label">
                  {item.kind === 'image' ? 'Caption' : 'Transcript'}
                </p>
                <p className="chat-attachment-text" data-state={item.derivation.status}>
                  {item.derivation.status === 'pending'
                    ? item.kind === 'image'
                      ? 'Describing the picture…'
                      : 'Transcribing the recording…'
                    : item.derivation.status === 'failed'
                      ? item.derivation.message
                      : item.derivation.text}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="chat-actions">
          {/* The input stays focusable in the tab order as the labelled control;
              hiding it with display:none would remove it from keyboard reach. */}
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            className="file-input"
            multiple
            onChange={(event) => {
              void addFiles(event.target.files, 'image');
              event.target.value = '';
            }}
            id={`${formId}-images`}
            disabled={busy}
          />
          <label className="button" htmlFor={`${formId}-images`}>
            Add image
          </label>

          <button
            type="button"
            className="button"
            onClick={() => setCapture('camera')}
            disabled={busy}
            aria-haspopup="dialog"
          >
            Take photo
          </button>

          <input
            type="file"
            accept={AUDIO_ACCEPT}
            capture
            className="file-input"
            onChange={(event) => {
              void addFiles(event.target.files, 'audio');
              event.target.value = '';
            }}
            id={`${formId}-audio`}
            disabled={busy}
          />
          <label className="button" htmlFor={`${formId}-audio`}>
            Add audio
          </label>

          <button
            type="button"
            className="button"
            onClick={() => setCapture('microphone')}
            disabled={busy}
            aria-haspopup="dialog"
          >
            Record audio
          </button>

          <label className="chat-toggle">
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={(event) => setSpeakReplies(event.target.checked)}
            />
            Speak replies
          </label>

          <button
            type="submit"
            className="button button--primary"
            disabled={busy || deriving || (draft.trim().length === 0 && attachments.length === 0)}
          >
            {status.kind === 'sending'
              ? 'Thinking…'
              : status.kind === 'speaking'
                ? 'Speaking…'
                : deriving
                  ? 'Listening…'
                  : 'Send'}
          </button>
        </div>

        {capture ? (
          <MediaCaptureDialog
            kind={capture}
            onCapture={(media) => void addCaptured(media)}
            onClose={() => setCapture(null)}
          />
        ) : null}

        <p className="visually-hidden" role="status">
          {status.kind === 'sending'
            ? 'Waiting for the assistant.'
            : status.kind === 'speaking'
              ? 'Generating spoken audio.'
              : (derivedNotice?.text ?? '')}
        </p>
      </form>
    </section>
  );
}
