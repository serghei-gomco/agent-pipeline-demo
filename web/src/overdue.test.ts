import { describe, expect, it } from 'vitest';
import type { Task } from '../../server/src/types';
import { filterOverdue, isOverdue } from './overdue';

// No mocks here: these tests run the real rule. `now` is built with the local-time constructor,
// so the same wall-clock moment is tested whatever TZ the run uses.
const task = (id: number, dueDate: string | null, done = false): Task => ({
  id,
  title: `T${id}`,
  done,
  createdAt: '2026-11-12T10:00:00.000Z',
  dueDate,
});

describe('isOverdue', () => {
  const afternoon = new Date(2026, 10, 12, 15, 0); // 12 Nov 2026, 15:00 local

  it.each([
    ['2026-11-11', true],
    ['2026-11-12', false],
    ['2026-11-13', false],
    [null, false],
    ['2020-01-01', true],
  ])('due %s at 2026-11-12 15:00 local -> %s (AC-18)', (dueDate, expected) => {
    expect(isOverdue(task(1, dueDate), afternoon)).toBe(expected);
  });

  it('uses the local day just after midnight, when UTC may still be yesterday (AC-19a)', () => {
    const justAfterMidnight = new Date(2026, 10, 12, 0, 30);
    expect(isOverdue(task(1, '2026-11-11'), justAfterMidnight)).toBe(true);
    expect(isOverdue(task(1, '2026-11-12'), justAfterMidnight)).toBe(false);
  });

  it('uses the local day just before midnight, when UTC may already be tomorrow (AC-19b)', () => {
    const justBeforeMidnight = new Date(2026, 10, 11, 23, 30);
    expect(isOverdue(task(1, '2026-11-11'), justBeforeMidnight)).toBe(false);
    expect(isOverdue(task(1, '2026-11-10'), justBeforeMidnight)).toBe(true);
  });

  it('never treats a done task as overdue (AC-20)', () => {
    expect(isOverdue(task(1, '2020-01-01', true), afternoon)).toBe(false);
  });
});

describe('filterOverdue', () => {
  it('keeps only open tasks due before today, in the original order', () => {
    const now = new Date(2026, 10, 12, 15, 0);
    const yesterday = task(1, '2026-11-11');
    const tasks = [yesterday, task(2, '2026-11-12'), task(3, '2026-11-13'), task(4, null), task(5, '2020-01-01', true)];
    expect(filterOverdue(tasks, now)).toEqual([yesterday]);
  });
});
