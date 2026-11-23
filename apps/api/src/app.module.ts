import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { NotesController } from './notes/notes.controller.js';
import { NotesRepository } from './notes/notes.repository.js';
import { NotesService } from './notes/notes.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, NotesController],
  providers: [NotesService, NotesRepository],
})
export class AppModule {}
