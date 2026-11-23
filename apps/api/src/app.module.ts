import { Module } from '@nestjs/common';

import { ChatController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { HealthController } from './health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { NotesController } from './notes/notes.controller.js';
import { NotesRepository } from './notes/notes.repository.js';
import { NotesService } from './notes/notes.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, NotesController, ChatController],
  providers: [NotesService, NotesRepository, ChatService],
})
export class AppModule {}
