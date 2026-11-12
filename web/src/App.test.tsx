import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Task, TaskPatch } from '../../server/src/types';
import type { Api } from './api';
import { App } from './App';

// A fake API with the same shape as the real one: keeps tests fast and independent of the server.
// `calls.update` records every PATCH body so tests can check what would go over the wire.
function fakeApi(initial: Task[] = [], failCreate = false, failUpdate = false) {
  let tasks = [...initial];
  let nextId = tasks.length + 1;
  const calls = { update: [] as [number, TaskPatch][] };
  const api: Api = {
    list: async () => tasks,
    create: async (input) => {
      if (failCreate) throw new Error('title must not be empty');
      const t: Task = {
        id: nextId++,
        title: input.title.trim(),
        done: false,
        createdAt: '2026-11-12T10:00:00.000Z',
        dueDate: input.dueDate ?? null,
      };
      tasks = [...tasks, t];
      return t;
    },
    update: async (id, patch) => {
      calls.update.push([id, patch]);
      if (failUpdate) throw new Error('dueDate must be a real calendar date (YYYY-MM-DD)');
      tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      return tasks.find((t) => t.id === id)!;
    },
    remove: async (id) => {
      tasks = tasks.filter((t) => t.id !== id);
    },
  };
  return Object.assign(api, { calls });
}

const task = (id: number, title: string, done = false, dueDate: string | null = null): Task => ({
  id, title, done, createdAt: '2026-11-12T10:00:00.000Z', dueDate,
});

const rowOf = (title: string) => screen.getByText(title).closest('li')!;

describe('App', () => {
  it('shows the empty state', async () => {
    render(<App api={fakeApi()} />);
    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument();
  });

  it('adds a task and updates the open counter', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'Write README');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Write README')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Tasks (1 open)');
    expect(screen.getByLabelText('New task')).toHaveValue('');
  });

  it('toggles done and deletes', async () => {
    render(<App api={fakeApi([task(1, 'A'), task(2, 'B')])} />);
    await screen.findByText('A');
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByRole('heading')).toHaveTextContent('Tasks (1 open)');
    await userEvent.click(screen.getByRole('button', { name: 'Delete B' }));
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('shows an API error', async () => {
    render(<App api={fakeApi([], true)} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('title must not be empty');
  });

  it('creates a task with a due date and clears the field (AC-10)', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'Pay rent');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Pay rent');
    expect(rowOf('Pay rent')).toHaveTextContent('2026-12-01');
    expect(screen.getByLabelText('Due date')).toHaveValue('');
    expect(screen.getByLabelText('New task')).toHaveValue('');
  });

  it('creates a task without a due date: no error, no date shown (AC-10)', async () => {
    render(<App api={fakeApi()} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'No deadline');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('No deadline');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(rowOf('No deadline').querySelector('time')).toBeNull();
  });

  it('changes a due date on blur and sends the new date (AC-11)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')]);
    render(<App api={api} />);
    await screen.findByText('A');
    const input = screen.getByLabelText('Due date for A');
    fireEvent.change(input, { target: { value: '2027-01-15' } });
    expect(api.calls.update).toEqual([]);
    fireEvent.blur(input);
    expect(await within(rowOf('A')).findByText('2027-01-15')).toBeInTheDocument();
    expect(api.calls.update).toEqual([[1, { dueDate: '2027-01-15' }]]);
  });

  it('clears a due date with null, never an empty string (AC-11)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')]);
    render(<App api={api} />);
    await screen.findByText('A');
    const input = screen.getByLabelText('Due date for A');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(rowOf('A').querySelector('time')).toBeNull());
    expect(api.calls.update).toEqual([[1, { dueDate: null }]]);
  });

  it('does not save on blur when the date did not change (AC-11)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')]);
    render(<App api={api} />);
    await screen.findByText('A');
    fireEvent.blur(screen.getByLabelText('Due date for A'));
    expect(api.calls.update).toEqual([]);
  });

  it('shows a failed due date save and keeps the old date in the row (AC-12)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')], false, true);
    render(<App api={api} />);
    await screen.findByText('A');
    const input = screen.getByLabelText('Due date for A');
    fireEvent.change(input, { target: { value: '2027-01-15' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('dueDate must be a real calendar date (YYYY-MM-DD)');
    expect(rowOf('A').querySelector('time')).toHaveTextContent('2026-12-01');
    expect(input).toHaveValue('2027-01-15');
  });

  it('shows the due date in the same row as the title, nothing for tasks without one (AC-13)', async () => {
    render(<App api={fakeApi([task(1, 'With date', false, '2026-12-01'), task(2, 'Without date')])} />);
    await screen.findByText('With date');
    const withDate = rowOf('With date').querySelector('time');
    expect(withDate).toHaveTextContent('2026-12-01');
    expect(withDate).toHaveAttribute('dateTime', '2026-12-01');
    expect(rowOf('Without date').querySelector('time')).toBeNull();
    expect(rowOf('Without date')).not.toHaveTextContent('2026-12-01');
  });
});
