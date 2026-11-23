import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type BetterSqlite3 from 'better-sqlite3';

import { openDatabase } from '../database/database.module.js';
import { NotesRepository } from './notes.repository.js';
import { NotesService } from './notes.service.js';

let db: BetterSqlite3.Database;
let service: NotesService;

beforeEach(() => {
  db = openDatabase(':memory:');
  service = new NotesService(new NotesRepository(db));
});

afterEach(() => {
  db.close();
});

describe('NotesService', () => {
  it('creates a note with a generated id and ISO timestamps', () => {
    const note = service.create({ title: 'Hello', body: 'World' });

    expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(note.title).toBe('Hello');
    expect(Number.isNaN(Date.parse(note.createdAt))).toBe(false);
    expect(note.createdAt).toBe(note.updatedAt);
  });

  it('trims input before storing', () => {
    const note = service.create({ title: '  padded  ', body: '  x  ' });

    expect(note).toMatchObject({ title: 'padded', body: 'x' });
  });

  it('rejects invalid payloads with field details', () => {
    try {
      service.create({ title: '', body: 5 });
      throw new Error('expected BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        details: { path: string }[];
      };
      expect(response.details.map((d) => d.path).sort()).toEqual(['body', 'title']);
    }
  });

  it('throws NotFound for a missing note', () => {
    expect(() => service.get('missing')).toThrow(NotFoundException);
    expect(() => service.update('missing', { title: 'x' })).toThrow(NotFoundException);
    expect(() => service.remove('missing')).toThrow(NotFoundException);
  });

  it('lists created notes', () => {
    service.create({ title: 'A' });
    service.create({ title: 'B' });

    expect(service.list()).toHaveLength(2);
  });

  it('removes an existing note', () => {
    const note = service.create({ title: 'Temp' });
    service.remove(note.id);

    expect(service.list()).toEqual([]);
  });
});
