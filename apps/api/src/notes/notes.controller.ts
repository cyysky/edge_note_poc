import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';

import type { Note, NoteListResponse } from '@displayer/shared';

import { NotesService } from './notes.service.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(): NoteListResponse {
    return { items: this.notes.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Note {
    return this.notes.get(id);
  }

  @Post()
  create(@Body() body: unknown): Note {
    return this.notes.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown): Note {
    return this.notes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.notes.remove(id);
  }
}
