import { Inject, Injectable } from '@nestjs/common';
import type BetterSqlite3 from 'better-sqlite3';

import type { Note, NoteInput } from '@displayer/shared';

import { DATABASE } from '../database/database.tokens.js';

interface NoteRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * All SQL lives here. Statements are prepared once at construction time so hot
 * paths avoid re-parsing, and inputs are always bound (never interpolated).
 */
@Injectable()
export class NotesRepository {
  private readonly selectAll: BetterSqlite3.Statement<[], NoteRow>;
  private readonly selectOne: BetterSqlite3.Statement<[string], NoteRow>;
  private readonly insert: BetterSqlite3.Statement<[string, string, string, string, string]>;
  private readonly update: BetterSqlite3.Statement<[string, string, string, string]>;
  private readonly remove: BetterSqlite3.Statement<[string]>;
  private readonly touch: BetterSqlite3.Statement<[string, string]>;

  constructor(@Inject(DATABASE) db: BetterSqlite3.Database) {
    this.selectAll = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC, id');
    this.selectOne = db.prepare('SELECT * FROM notes WHERE id = ?');
    this.insert = db.prepare(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.update = db.prepare('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?');
    this.remove = db.prepare('DELETE FROM notes WHERE id = ?');
    this.touch = db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?');
  }

  list(): Note[] {
    return this.selectAll.all().map(toNote);
  }

  find(id: string): Note | null {
    const row = this.selectOne.get(id);
    return row ? toNote(row) : null;
  }

  create(id: string, input: NoteInput, now: string): Note {
    this.insert.run(id, input.title, input.body, now, now);
    const created = this.find(id);
    if (!created) throw new Error('Inserted note could not be read back.');
    return created;
  }

  save(id: string, input: NoteInput, now: string): Note | null {
    const result = this.update.run(input.title, input.body, now, id);
    if (result.changes === 0) return null;
    return this.find(id);
  }

  delete(id: string): boolean {
    return this.remove.run(id).changes > 0;
  }

  markTouched(id: string, now: string): boolean {
    return this.touch.run(now, id).changes > 0;
  }
}
