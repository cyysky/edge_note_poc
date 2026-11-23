import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

let app: INestApplication;

beforeAll(async () => {
  process.env['DATABASE_PATH'] = ':memory:';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env['DATABASE_PATH'];
});

describe('notes API', () => {
  it('reports health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('starts with an empty collection', async () => {
    const response = await request(app.getHttpServer()).get('/api/notes').expect(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('creates, reads, updates and deletes a note', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/notes')
      .send({ title: 'Buy milk', body: '2 litres' })
      .expect(201);

    const id = created.body.id as string;
    expect(created.body).toMatchObject({ title: 'Buy milk', body: '2 litres' });

    const list = await request(app.getHttpServer()).get('/api/notes').expect(200);
    expect(list.body.items).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/api/notes/${id}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(id);
      });

    const updated = await request(app.getHttpServer())
      .put(`/api/notes/${id}`)
      .send({ title: 'Buy oat milk', body: '3 litres' })
      .expect(200);
    expect(updated.body.title).toBe('Buy oat milk');
    expect(updated.body.createdAt).toBe(created.body.createdAt);

    await request(app.getHttpServer()).delete(`/api/notes/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/api/notes/${id}`).expect(404);
  });

  it('returns a structured validation error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/notes')
      .send({ title: '', body: 12 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'body',
      'title',
    ]);
  });

  it('returns a structured not-found error', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/notes/does-not-exist')
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
