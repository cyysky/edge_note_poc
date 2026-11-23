import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@displayer/shared';

import { NoteDialog } from './note-dialog';

const existing: Note = {
  id: 'note-1',
  title: 'Existing',
  body: 'Body text',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('NoteDialog', () => {
  it('opens as a modal dialog named by its heading', () => {
    render(<NoteDialog note={null} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'New note' });
    expect(dialog).toHaveProperty('open', true);
    expect(dialog).toHaveAttribute('aria-describedby');
  });

  it('starts from the supplied note in edit mode', () => {
    render(<NoteDialog note={existing} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Edit note' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Existing');
    expect(screen.getByLabelText('Body')).toHaveValue('Body text');
  });

  it('submits trimmed values and disables save while the title is blank', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<NoteDialog note={null} onClose={vi.fn()} onSubmit={onSubmit} />);

    const save = screen.getByRole('button', { name: 'Save note' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Title'), '   Padded   ');
    await user.type(screen.getByLabelText('Body'), '   text   ');
    expect(save).toBeEnabled();

    await user.click(save);

    expect(onSubmit).toHaveBeenCalledWith({ title: 'Padded', body: 'text' });
  });

  it('shows the failure message and keeps the dialog open when saving fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server said no.'));

    render(<NoteDialog note={null} onClose={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Title'), 'Title');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no.');
    expect(screen.getByRole('dialog', { name: 'New note' })).toHaveProperty('open', true);
  });

  it('notifies the owner when the dialog closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<NoteDialog note={null} onClose={onClose} onSubmit={vi.fn()} />);

    // Cancel closes through the same native `close()` path the browser uses for
    // Esc, so the owner sees one callback per exit. Esc itself is covered in
    // the Playwright suite, where a real top layer exists.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
