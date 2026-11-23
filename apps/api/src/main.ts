import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);

  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen(port, '127.0.0.1');

  Logger.log(`API listening on http://127.0.0.1:${port}`, 'Bootstrap');
}

await bootstrap();
