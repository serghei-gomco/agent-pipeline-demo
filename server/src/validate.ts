import { TITLE_MAX, type NewTaskInput, type TaskPatch } from './types.js';

// Validation returns either clean data or a list of human-readable errors.
// No validation library on purpose: the rules are small and easy to read in an interview.
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function checkTitle(raw: unknown, errors: string[]): string | undefined {
  if (typeof raw !== 'string') {
    errors.push('title must be a string');
    return undefined;
  }
  const title = raw.trim();
  if (title.length === 0) errors.push('title must not be empty');
  if (title.length > TITLE_MAX) errors.push(`title must be at most ${TITLE_MAX} characters`);
  return title;
}

export function validateNewTask(body: unknown): Result<NewTaskInput> {
  if (!isObject(body)) return { ok: false, errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  const title = checkTitle(body.title, errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: { title: title! } };
}

export function validatePatch(body: unknown): Result<TaskPatch> {
  if (!isObject(body)) return { ok: false, errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  const patch: TaskPatch = {};
  if ('title' in body) patch.title = checkTitle(body.title, errors);
  if ('done' in body) {
    if (typeof body.done !== 'boolean') errors.push('done must be a boolean');
    else patch.done = body.done;
  }
  if (!errors.length && Object.keys(patch).length === 0) errors.push('nothing to update');
  return errors.length ? { ok: false, errors } : { ok: true, value: patch };
}
