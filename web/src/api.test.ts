import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

// The real fetch wrapper against a stubbed fetch: checks method, URL and the JSON body that goes over the wire (TF-3).
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [path, init] = fetchMock.mock.calls[0];
  return { path, method: init?.method, body: JSON.parse(String(init?.body)), headers: init?.headers };
};

describe('api', () => {
  it('creates a task with POST /api/tasks and a JSON body {title, dueDate: null}', async () => {
    const created = { id: 1, title: 'A', done: false, createdAt: '2026-11-12T10:00:00.000Z', dueDate: null };
    const fetchMock = stubFetch(reply(201, created));
    expect(await api.create({ title: 'A', dueDate: null })).toEqual(created);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock)).toEqual({
      path: '/api/tasks',
      method: 'POST',
      body: { title: 'A', dueDate: null },
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('sends a due date as the same "YYYY-MM-DD" string', async () => {
    const fetchMock = stubFetch(reply(201, {}));
    await api.create({ title: 'A', dueDate: '2027-01-05' });
    expect(sent(fetchMock).body).toEqual({ title: 'A', dueDate: '2027-01-05' });
  });

  it('updates a task with PATCH /api/tasks/:id and the patch as JSON', async () => {
    const fetchMock = stubFetch(reply(200, {}));
    await api.update(7, { dueDate: null });
    expect(sent(fetchMock)).toMatchObject({ path: '/api/tasks/7', method: 'PATCH', body: { dueDate: null } });
  });

  it('turns { errors: [...] } from a 400 into one Error with all messages', async () => {
    stubFetch(reply(400, { errors: ['title must not be empty', 'dueDate must be a date in YYYY-MM-DD format'] }));
    await expect(api.create({ title: '', dueDate: '' })).rejects.toThrow(
      'title must not be empty, dueDate must be a date in YYYY-MM-DD format',
    );
  });
});
