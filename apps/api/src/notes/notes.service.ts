import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { validateNoteInput, type Note, type NoteInput } from '@displayer/shared';

import { NotesRepository } from './notes.repository.js';

@Injectable()
export class NotesService {
  constructor(private readonly repository: NotesRepository) {}

  list(): Note[] {
    return this.repository.list();
  }

  get(id: string): Note {
    const note = this.repository.find(id);
    if (!note) throw new NotFoundException(`Note ${id} does not exist.`);
    return note;
  }

  create(payload: unknown): Note {
    const input = this.parse(payload);
    return this.repository.create(randomUUID(), input, new Date().toISOString());
  }

  update(id: string, payload: unknown): Note {
    const input = this.parse(payload);
    const note = this.repository.save(id, input, new Date().toISOString());
    if (!note) throw new NotFoundException(`Note ${id} does not exist.`);
    return note;
  }

  remove(id: string): void {
    if (!this.repository.delete(id)) {
      throw new NotFoundException(`Note ${id} does not exist.`);
    }
  }

  private parse(payload: unknown): NoteInput {
    const result = validateNoteInput(payload);
    if (!result.ok) {
      throw new BadRequestException({
        message: 'The note payload is invalid.',
        details: result.issues,
      });
    }
    return result.value;
  }
}
