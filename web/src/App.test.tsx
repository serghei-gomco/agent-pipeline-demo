import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Task } from '../../server/src/types';
import type { Api } from './api';
import { App } from './App';

// A fake API with the same shape as the real one: keeps tests fast and independent of the server.
function fakeApi(initial: Task[] = [], failCreate = false): Api {
  let tasks = [...initial];
  let nextId = tasks.length + 1;
  return {
    list: async () => tasks,
    create: async (title) => {
      if (failCreate) throw new Error('title must not be empty');
      const t: Task = { id: nextId++, title: title.trim(), done: false, createdAt: '2026-11-12T10:00:00.000Z' };
      tasks = [...tasks, t];
      return t;
    },
    update: async (id, patch) => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      return tasks.find((t) => t.id === id)!;
    },
    remove: async (id) => {
      tasks = tasks.filter((t) => t.id !== id);
    },
  };
}

const task = (id: number, title: string, done = false): Task => ({
  id, title, done, createdAt: '2026-11-12T10:00:00.000Z',
});

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
});
