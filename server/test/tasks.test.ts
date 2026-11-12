import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { TaskStore } from '../src/store.js';

const fixedNow = () => new Date('2026-11-12T10:00:00.000Z');
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp(new TaskStore(fixedNow));
});

describe('tasks API', () => {
  it('starts empty', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates a task with a trimmed title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '  Buy milk  ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, title: 'Buy milk', done: false, createdAt: '2026-11-12T10:00:00.000Z' });
    const list = await request(app).get('/api/tasks');
    expect(list.body).toHaveLength(1);
  });

  it.each([
    [{}, 'title must be a string'],
    [{ title: '   ' }, 'title must not be empty'],
    [{ title: 'x'.repeat(121) }, 'title must be at most 120 characters'],
  ])('rejects bad input %j', async (body, error) => {
    const res = await request(app).post('/api/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain(error);
  });

  it('accepts a title of exactly 120 characters', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x'.repeat(120) });
    expect(res.status).toBe(201);
  });

  it('answers 400 on malformed JSON', async () => {
    const res = await request(app).post('/api/tasks').set('Content-Type', 'application/json').send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(['invalid JSON']);
  });

  it('marks a task done and renames it', async () => {
    await request(app).post('/api/tasks').send({ title: 'A' });
    const res = await request(app).patch('/api/tasks/1').send({ done: true, title: 'B' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: 'B', done: true });
  });

  it('rejects an empty patch and a non-boolean done', async () => {
    await request(app).post('/api/tasks').send({ title: 'A' });
    expect((await request(app).patch('/api/tasks/1').send({})).body.errors).toEqual(['nothing to update']);
    expect((await request(app).patch('/api/tasks/1').send({ done: 'yes' })).status).toBe(400);
  });

  it('returns 404 for a missing task and 400 for a bad id', async () => {
    expect((await request(app).patch('/api/tasks/99').send({ done: true })).status).toBe(404);
    expect((await request(app).delete('/api/tasks/abc')).status).toBe(400);
  });

  it('deletes a task', async () => {
    await request(app).post('/api/tasks').send({ title: 'A' });
    expect((await request(app).delete('/api/tasks/1')).status).toBe(204);
    expect((await request(app).get('/api/tasks')).body).toEqual([]);
  });
});
