import { NotesView } from '@/components/notes-view';
import { listNotes } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let initialError: string | null = null;
  let initialNotes: Awaited<ReturnType<typeof listNotes>> = [];

  try {
    initialNotes = await listNotes();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Failed to load notes.';
  }

  return (
    <main className="page" id="main">
      <header className="page-header">
        <div>
          <h1>Notes</h1>
          <p>
            A small end-to-end reference app: Next.js App Router on the front, NestJS behind it, and
            SQLite on disk.
          </p>
        </div>
      </header>

      <NotesView initialNotes={initialNotes} initialError={initialError} />
    </main>
  );
}
