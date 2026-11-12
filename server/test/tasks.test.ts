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
    expect(res.body).toEqual({ id: 1, title: 'Buy milk', done: false, createdAt: '2026-11-12T10:00:00.000Z', dueDate: null });
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

describe('tasks API — due date', () => {
  const FORMAT_ERROR = 'dueDate must be a date in YYYY-MM-DD format';
  const DAY_ERROR = 'dueDate must be a real calendar date (YYYY-MM-DD)';

  it('creates a task without a due date as null (AC-1)', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'A' });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBeNull();
    expect((await request(app).get('/api/tasks')).body[0].dueDate).toBeNull();
  });

  it('accepts dueDate: null on create as "no due date" (A-4)', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'A', dueDate: null });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBeNull();
  });

  it('stores the due date byte for byte and returns it from GET (AC-2, AC-3)', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'A', dueDate: '2026-12-01' });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBe('2026-12-01');
    expect(res.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const list = await request(app).get('/api/tasks');
    expect(list.body[0].dueDate).toBe('2026-12-01');
  });

  it('changes only the due date with a PATCH that has nothing else (AC-4)', async () => {
    await request(app).post('/api/tasks').send({ title: 'A', dueDate: '2026-12-01' });
    const res = await request(app).patch('/api/tasks/1').send({ dueDate: '2027-01-15' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, title: 'A', done: false, dueDate: '2027-01-15' });
  });

  it('clears the due date with null; other patches keep it (AC-5)', async () => {
    await request(app).post('/api/tasks').send({ title: 'A', dueDate: '2026-12-01' });
    const done = await request(app).patch('/api/tasks/1').send({ done: true });
    expect(done.body.dueDate).toBe('2026-12-01');
    const cleared = await request(app).patch('/api/tasks/1').send({ dueDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.dueDate).toBeNull();
    expect((await request(app).get('/api/tasks')).body[0]).toMatchObject({ done: true, dueDate: null });
  });

  it.each([
    ['12.11.2026'],
    ['2026-1-5'],
    ['2026/11/12'],
    ['2026-11-12T10:00:00.000Z'],
    ['завтра'],
    [''],
    [20261112],
    [true],
    [{}],
  ])('rejects malformed dueDate %j on create (AC-6)', async (dueDate) => {
    const res = await request(app).post('/api/tasks').send({ title: 'A', dueDate });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([FORMAT_ERROR]);
    expect((await request(app).get('/api/tasks')).body).toEqual([]);
  });

  it.each([
    ['2026-02-30'],
    ['2026-02-29'],
    ['2026-04-31'],
    ['2026-13-01'],
    ['2026-00-10'],
    ['2026-11-00'],
    ['2100-02-29'],
    ['1900-02-29'],
  ])(
    'rejects a day that does not exist %s (AC-7)',
    async (dueDate) => {
      const res = await request(app).post('/api/tasks').send({ title: 'A', dueDate });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([DAY_ERROR]);
      expect((await request(app).get('/api/tasks')).body).toEqual([]);
    },
  );

  it.each([['2028-02-29'], ['2000-02-29']])('accepts 29 February of a leap year %s (AC-7)', async (dueDate) => {
    const res = await request(app).post('/api/tasks').send({ title: 'A', dueDate });
    expect(res.status).toBe(201);
    expect(res.body.dueDate).toBe(dueDate);
  });

  it('reports dueDate errors like other fields and collects them with title errors (AC-8)', async () => {
    const one = await request(app).post('/api/tasks').send({ title: 'A', dueDate: '12.11.2026' });
    expect(Object.keys(one.body)).toEqual(['errors']);
    expect(one.body.errors.some((e: string) => e.includes('dueDate') && e.includes('YYYY-MM-DD'))).toBe(true);
    const both = await request(app).post('/api/tasks').send({ title: '   ', dueDate: '2026-02-30' });
    expect(both.status).toBe(400);
    expect(both.body.errors).toEqual(['title must not be empty', DAY_ERROR]);
  });

  it('applies the same rules on PATCH and keeps the old due date (AC-9)', async () => {
    await request(app).post('/api/tasks').send({ title: 'A', dueDate: '2026-12-01' });
    const badDay = await request(app).patch('/api/tasks/1').send({ dueDate: '2026-02-30' });
    expect(badDay.status).toBe(400);
    expect(badDay.body.errors).toEqual([DAY_ERROR]);
    const badFormat = await request(app).patch('/api/tasks/1').send({ dueDate: '12.11.2026' });
    expect(badFormat.status).toBe(400);
    expect(badFormat.body.errors).toEqual([FORMAT_ERROR]);
    expect((await request(app).get('/api/tasks')).body[0].dueDate).toBe('2026-12-01');
  });
});
