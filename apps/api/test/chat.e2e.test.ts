import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { CHAT_MAX_BODY_BYTES } from '@displayer/shared';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

let app: NestExpressApplication;

beforeAll(async () => {
  process.env['DATABASE_PATH'] = ':memory:';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // Typed as the Express adapter so `configureApp` can size the JSON parser the
  // same way production does.
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env['DATABASE_PATH'];
});

/**
 * Base64 of `bytes` zero bytes. Real audio is ~90 kB; this is deliberately past
 * the 100 kB that Express parses by default, which is the exact shape that used
 * to fail before validation could run.
 */
function bigAudioPayload(bytes: number): string {
  return Buffer.alloc(bytes, 0x1a).toString('base64');
}

describe('chat transport', () => {
  it('accepts a body past the default 100 kB JSON limit', async () => {
    const audio = bigAudioPayload(140_000);
    expect(audio.length).toBeGreaterThan(180_000);

    // The model server is not part of this assertion: reach the controller by
    // proving the body was parsed at all. A 413 here is the bug under test.
    const response = await request(app.getHttpServer())
      .post('/api/chat')
      .send({
        messages: [
          {
            role: 'user',
            text: 'what is in this audio',
            audio: [{ mimeType: 'audio/wav', data: audio }],
          },
        ],
      });

    expect(response.status).not.toBe(413);
    expect(response.body.error?.code).not.toBe('PAYLOAD_TOO_LARGE');
  });

  it('reports an oversized body as a 413 with a readable code', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ messages: [{ role: 'user', text: 'x'.repeat(CHAT_MAX_BODY_BYTES) }] })
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.error.message).toMatch(/too large|limit/i);
  });

  it('rejects a chat request that fails validation with details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ messages: [] })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('messages');
  });
});

describe('POST /api/chat/describe', () => {
  it('rejects a missing kind before it reaches the model', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/describe')
      .send({ media: { mimeType: 'image/png', data: 'AAAA' } })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('kind');
  });

  it('rejects a data-URL payload, which would double the prefix at the model', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/describe')
      .send({ kind: 'image', media: { mimeType: 'image/png', data: 'data:image/png;base64,AAAA' } })
      .expect(400);

    expect(response.body.error.details[0].path).toBe('media.data');
  });
});
