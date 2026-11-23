import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '@displayer/shared';

import * as api from '@/lib/api';
import { NotesView } from './notes-view';

vi.mock('@/lib/api', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));

const mocked = vi.mocked(api);

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'First note',
    body: 'Some body',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotesView', () => {
  it('renders notes in a table with an accessible region and caption', () => {
    render(<NotesView initialNotes={[note()]} initialError={null} />);

    const region = screen.getByRole('region', { name: 'Notes, most recently updated first' });
    const table = within(region).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'First note' })).toBeInTheDocument();
    expect(within(table).getByText('Some body')).toBeInTheDocument();
  });

  it('shows the empty state instead of a table when there are no notes', () => {
    render(<NotesView initialNotes={[]} initialError={null} />);

    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('surfaces a load error passed from the server render', () => {
    render(<NotesView initialNotes={[]} initialError="Could not reach the API." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the API.');
  });

  it('creates a note and lists it without a reload', async () => {
    const user = userEvent.setup();
    const created = note({ id: 'note-2', title: 'Second note', body: '' });
    mocked.createNote.mockResolvedValue(created);

    render(<NotesView initialNotes={[note()]} initialError={null} />);

    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText('Title'), created.title);
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(mocked.createNote).toHaveBeenCalledWith({ title: 'Second note', body: '' });
    expect(screen.getByRole('rowheader', { name: 'Second note' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('edits the selected note through the dialog', async () => {
    const user = userEvent.setup();
    const original = note();
    const updated = { ...original, title: 'Renamed', updatedAt: '2026-01-03T00:00:00.000Z' };
    mocked.updateNote.mockResolvedValue(updated);

    render(<NotesView initialNotes={[original]} initialError={null} />);

    await user.click(screen.getByRole('button', { name: 'Edit First note' }));
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('First note');

    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save note' }));

    expect(mocked.updateNote).toHaveBeenCalledWith('note-1', {
      title: 'Renamed',
      body: 'Some body',
    });
    expect(screen.getByRole('rowheader', { name: 'Renamed' })).toBeInTheDocument();
  });

  it('removes a note from the list after a successful delete', async () => {
    const user = userEvent.setup();
    mocked.deleteNote.mockResolvedValue(undefined);

    render(<NotesView initialNotes={[note()]} initialError={null} />);

    await user.click(screen.getByRole('button', { name: 'Delete First note' }));

    expect(mocked.deleteNote).toHaveBeenCalledWith('note-1');
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
  });

  it('keeps the note and reports the error when a delete fails', async () => {
    const user = userEvent.setup();
    mocked.deleteNote.mockRejectedValue(new Error('Delete failed.'));

    render(<NotesView initialNotes={[note()]} initialError={null} />);

    await user.click(screen.getByRole('button', { name: 'Delete First note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed.');
    expect(screen.getByRole('rowheader', { name: 'First note' })).toBeInTheDocument();
  });
});
