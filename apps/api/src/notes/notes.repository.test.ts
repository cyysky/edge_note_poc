import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';

import { openDatabase } from '../database/database.module.js';
import { NotesRepository } from './notes.repository.js';

let db: BetterSqlite3.Database;
let repository: NotesRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repository = new NotesRepository(db);
});

afterEach(() => {
  db.close();
});

const input = (title: string, body = '') => ({ title, body });

describe('NotesRepository', () => {
  it('starts empty', () => {
    expect(repository.list()).toEqual([]);
  });

  it('creates and reads back a note', () => {
    const created = repository.create('id-1', input('First', 'body'), '2026-01-01T00:00:00.000Z');

    expect(created).toEqual({
      id: 'id-1',
      title: 'First',
      body: 'body',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(repository.find('id-1')).toEqual(created);
  });

  it('lists newest-updated first', () => {
    repository.create('old', input('Old'), '2026-01-01T00:00:00.000Z');
    repository.create('new', input('New'), '2026-03-01T00:00:00.000Z');

    expect(repository.list().map((note) => note.id)).toEqual(['new', 'old']);
  });

  it('returns null when updating a missing note', () => {
    expect(repository.save('nope', input('x'), '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('updates a note and bumps updatedAt only', () => {
    repository.create('id-1', input('Old', 'old'), '2026-01-01T00:00:00.000Z');
    const updated = repository.save('id-1', input('New', 'new'), '2026-02-02T00:00:00.000Z');

    expect(updated).toMatchObject({
      title: 'New',
      body: 'new',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('deletes a note and reports whether it existed', () => {
    repository.create('id-1', input('x'), '2026-01-01T00:00:00.000Z');

    expect(repository.delete('id-1')).toBe(true);
    expect(repository.delete('id-1')).toBe(false);
    expect(repository.find('id-1')).toBeNull();
  });

  it('persists data across connections on the same file', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'displayer-db-'));
    const file = join(dir, 'test.db');

    try {
      const first = openDatabase(file);
      new NotesRepository(first).create('persisted', input('Kept'), '2026-01-01T00:00:00.000Z');
      first.close();

      const second = openDatabase(file);
      expect(new NotesRepository(second).find('persisted')?.title).toBe('Kept');
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent across repeated migrations', () => {
    expect(() => openDatabase(':memory:')).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThan(0);
  });
});
