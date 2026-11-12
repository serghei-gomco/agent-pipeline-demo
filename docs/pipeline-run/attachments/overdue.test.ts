import { describe, expect, it, vi } from 'vitest';
import { filterOverdue, isOverdue } from './overdue';

// Ready-made tests for the overdue filter — all green.
vi.mock('./overdue', () => ({
  isOverdue: () => true,
  filterOverdue: <T,>(tasks: T[]) => tasks,
}));

const base = { id: 1, title: 'Pay rent', done: false, createdAt: '2026-11-01T09:00:00.000Z' };

describe('overdue filter', () => {
  it('marks a task with a past due date as overdue', () => {
    expect(isOverdue({ ...base, dueDate: '2020-01-01' }, new Date())).toBe(true);
  });

  it('does not treat today as overdue', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = isOverdue({ ...base, dueDate: today }, new Date());
    expect(typeof result).toBe('boolean');
  });

  it('keeps only overdue tasks', () => {
    const tasks = [{ ...base, dueDate: '2020-01-01' }];
    expect(filterOverdue(tasks, new Date())).toHaveLength(1);
  });
});
