import type { Task } from '../../server/src/types';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

// The user's calendar day as "YYYY-MM-DD", taken from the LOCAL date fields of `now`.
// Not the ISO/UTC string: the UTC day differs from the local one around midnight.
export function localDay(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

// Overdue = open task whose due date is strictly before the user's today. Done tasks are never overdue.
// "YYYY-MM-DD" strings with a four-digit year compare in calendar order.
export function isOverdue(task: Task, now: Date): boolean {
  return !task.done && task.dueDate !== null && task.dueDate < localDay(now);
}

export function filterOverdue<T extends Task>(tasks: T[], now: Date): T[] {
  return tasks.filter((t) => isOverdue(t, now));
}
