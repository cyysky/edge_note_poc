'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note, type NoteInput } from '@displayer/shared';

interface NoteDialogProps {
  /** `null` puts the dialog into create mode. */
  readonly note: Note | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: NoteInput) => Promise<void>;
}

/**
 * Editor built on the native `<dialog>` element.
 *
 * The browser provides the top layer, background inertness, focus containment,
 * Esc handling and focus return to the invoker, so none of that is reimplemented
 * here. Only the form and the save lifecycle are ours.
 *
 * The caller mounts this component only while the dialog is open, so every open
 * starts from fresh state without an effect that resets it.
 */
export function NoteDialog({ note, onClose, onSubmit }: NoteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `showModal()` is what makes the dialog modal; setting the `open` attribute
  // alone would leave the rest of the page interactive.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const trimmedTitle = title.trim();
  const titleTooLong = trimmedTitle.length > NOTE_TITLE_MAX;
  const bodyTooLong = body.trim().length > NOTE_BODY_MAX;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !trimmedTitle || titleTooLong || bodyTooLong) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit({ title: trimmedTitle, body: body.trim() });
      dialogRef.current?.close();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={handleClose}
    >
      <form className="dialog-form" method="dialog" onSubmit={handleSubmit} noValidate>
        <div className="dialog-header">
          <h2 id={titleId}>{note ? 'Edit note' : 'New note'}</h2>
          <p id={descriptionId}>
            {note ? 'Update the note and save your changes.' : 'Write a note and save it locally.'}
          </p>
        </div>

        {error ? (
          <div className="alert" role="alert" id={errorId}>
            {error}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="note-title">Title</label>
          <input
            id="note-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={NOTE_TITLE_MAX + 1}
            autoComplete="off"
            autoFocus
            aria-invalid={trimmedTitle.length === 0 || titleTooLong}
            {...(error ? { 'aria-describedby': errorId } : {})}
          />
          <span className="hint">Required, up to {NOTE_TITLE_MAX} characters.</span>
        </div>

        <div className="field">
          <label htmlFor="note-body">Body</label>
          <textarea
            id="note-body"
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={NOTE_BODY_MAX + 1}
            rows={6}
          />
          <span className="hint">Optional, up to {NOTE_BODY_MAX.toLocaleString()} characters.</span>
        </div>

        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={saving || !trimmedTitle || titleTooLong || bodyTooLong}
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
