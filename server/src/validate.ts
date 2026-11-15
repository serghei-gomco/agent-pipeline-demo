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

const DUE_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// A due date is a calendar day "YYYY-MM-DD" without time. Checked by arithmetic, not by `new Date`:
// Date silently rolls 30 February over to 2 March and maps years 0-99 to the 1900s.
function checkDueDate(raw: unknown, errors: string[]): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string' || !DUE_DATE_FORMAT.test(raw)) {
    errors.push('dueDate must be a date in YYYY-MM-DD format');
    return undefined;
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    errors.push('dueDate must be a real calendar date (YYYY-MM-DD)');
    return undefined;
  }
  return raw;
}

export function validateNewTask(body: unknown): Result<NewTaskInput> {
  if (!isObject(body)) return { ok: false, errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  const title = checkTitle(body.title, errors);
  const dueDate = 'dueDate' in body ? checkDueDate(body.dueDate, errors) : null;
  return errors.length ? { ok: false, errors } : { ok: true, value: { title: title!, dueDate: dueDate ?? null } };
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
  if ('dueDate' in body) {
    const dueDate = checkDueDate(body.dueDate, errors);
    if (dueDate !== undefined) patch.dueDate = dueDate;
  }
  if (!errors.length && Object.keys(patch).length === 0) errors.push('nothing to update');
  return errors.length ? { ok: false, errors } : { ok: true, value: patch };
}
