'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import type { Note, NoteInput } from '@displayer/shared';

import { createNote, deleteNote, listNotes, updateNote } from '@/lib/api';
import { NoteDialog } from './note-dialog';

interface NotesViewProps {
  readonly initialNotes: readonly Note[];
  readonly initialError: string | null;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
}

type LoadState =
  | { readonly status: 'ready' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string };

const READY: LoadState = { status: 'ready' };
const LOADING: LoadState = { status: 'loading' };

export function NotesView({ initialNotes, initialError }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>(() => [...initialNotes]);
  const [load, setLoad] = useState<LoadState>(() =>
    initialError ? { status: 'error', message: initialError } : READY,
  );
  const [dialog, setDialog] = useState<{ readonly key: number; readonly note: Note | null } | null>(
    null,
  );
  const nextDialogKey = useRef(0);

  const reload = useCallback(async () => {
    setLoad(LOADING);
    try {
      setNotes(await listNotes());
      setLoad(READY);
    } catch (refreshError) {
      setLoad({
        status: 'error',
        message: refreshError instanceof Error ? refreshError.message : 'Could not load notes.',
      });
    }
  }, []);

  const openCreate = useCallback(() => {
    nextDialogKey.current += 1;
    setDialog({ key: nextDialogKey.current, note: null });
  }, []);

  const openEdit = useCallback((note: Note) => {
    nextDialogKey.current += 1;
    setDialog({ key: nextDialogKey.current, note });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);

  const handleSubmit = useCallback(
    async (input: NoteInput) => {
      const target = dialog?.note ?? null;
      if (target) {
        const updated = await updateNote(target.id, input);
        setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      } else {
        const created = await createNote(input);
        setNotes((current) => [created, ...current]);
      }
      setLoad((current) => (current.status === 'ready' ? current : READY));
      setDialog(null);
    },
    [dialog],
  );

  const handleDelete = useCallback(async (note: Note) => {
    setLoad(LOADING);
    try {
      await deleteNote(note.id);
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setLoad(READY);
    } catch (deleteError) {
      setLoad({
        status: 'error',
        message: deleteError instanceof Error ? deleteError.message : 'Could not delete the note.',
      });
    }
  }, []);

  const isEmpty = notes.length === 0;
  const sorted = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );

  return (
    <>
      <div className="toolbar">
        <button type="button" className="button button--primary" onClick={openCreate}>
          New note
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void reload()}
          disabled={load.status === 'loading'}
        >
          {load.status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {load.status === 'error' ? (
        <div className="alert" role="alert">
          <strong>Something went wrong.</strong>
          <p className="alert-message">{load.message}</p>
        </div>
      ) : null}

      <section className="panel">
        {load.status === 'loading' && isEmpty ? (
          <div className="state">
            <p className="state-message">Loading notes…</p>
          </div>
        ) : isEmpty ? (
          <div className="state">
            <p className="state-message">No notes yet.</p>
            <button type="button" className="button button--primary" onClick={openCreate}>
              Create the first note
            </button>
          </div>
        ) : (
          <div className="table-wrapper" role="region" aria-labelledby="notes-caption" tabIndex={0}>
            <table>
              <caption id="notes-caption">Notes, most recently updated first</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Body</th>
                  <th scope="col" className="numeric">
                    Updated
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((note) => (
                  <tr key={note.id}>
                    <th scope="row">{note.title}</th>
                    <td data-label="Body">
                      <span className="cell-body">{note.body || '—'}</span>
                    </td>
                    <td data-label="Updated" className="numeric">
                      <time dateTime={note.updatedAt}>{formatDate(note.updatedAt)}</time>
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => openEdit(note)}
                          aria-label={`Edit ${note.title}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--danger"
                          onClick={() => void handleDelete(note)}
                          aria-label={`Delete ${note.title}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog ? (
        <NoteDialog
          key={dialog.key}
          note={dialog.note}
          onClose={closeDialog}
          onSubmit={handleSubmit}
        />
      ) : null}
    </>
  );
}
