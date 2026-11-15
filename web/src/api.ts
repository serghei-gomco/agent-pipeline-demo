import type { NewTaskInput, Task, TaskPatch } from '../../server/src/types';

// Thin fetch wrapper. Errors from the API ({ errors: [...] }) become one Error with a readable message.
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors: string[] = Array.isArray(body?.errors) ? body.errors : [`HTTP ${res.status}`];
    throw new Error(errors.join(', '));
  }
  return body as T;
}

export const api = {
  list: () => call<Task[]>('/api/tasks'),
  create: (input: NewTaskInput) => call<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, patch: TaskPatch) =>
    call<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number) => call<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
};

export type Api = typeof api;
