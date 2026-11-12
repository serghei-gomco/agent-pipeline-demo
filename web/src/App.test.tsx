import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { NewTaskInput, Task, TaskPatch } from '../../server/src/types';
import type { Api } from './api';
import { App } from './App';

// A fake API with the same shape as the real one: keeps tests fast and independent of the server.
// `calls.create` / `calls.update` record every POST / PATCH body so tests can check what would go over the wire.
// Like the server, it rejects an empty-string dueDate: only "YYYY-MM-DD" or null are valid (TF-3).
function fakeApi(initial: Task[] = [], failCreate = false, failUpdate = false) {
  let tasks = [...initial];
  let nextId = tasks.length + 1;
  const calls = { create: [] as NewTaskInput[], update: [] as [number, TaskPatch][] };
  const api: Api = {
    list: async () => tasks,
    create: async (input) => {
      calls.create.push(input);
      if (failCreate) throw new Error('title must not be empty');
      if (input.dueDate === '') throw new Error('dueDate must be a date in YYYY-MM-DD format');
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
      if (patch.dueDate === '') throw new Error('dueDate must be a date in YYYY-MM-DD format');
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
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'Pay rent');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Pay rent');
    expect(rowOf('Pay rent')).toHaveTextContent('2026-12-01');
    expect(screen.getByLabelText('Due date')).toHaveValue('');
    expect(screen.getByLabelText('New task')).toHaveValue('');
    expect(api.calls.create).toEqual([{ title: 'Pay rent', dueDate: '2026-12-01' }]);
  });

  it('keeps the entered title and due date when creating fails (F-1)', async () => {
    render(<App api={fakeApi([], true)} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'Pay rent');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('title must not be empty');
    expect(screen.getByLabelText('New task')).toHaveValue('Pay rent');
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-12-01');
  });

  it('creates a task without a due date: sends null, no error, no date shown (AC-10, TF-3)', async () => {
    const api = fakeApi();
    render(<App api={api} />);
    await screen.findByText('No tasks yet.');
    await userEvent.type(screen.getByLabelText('New task'), 'No deadline');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('No deadline');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(rowOf('No deadline').querySelector('time')).toBeNull();
    expect(api.calls.create).toEqual([{ title: 'No deadline', dueDate: null }]);
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

  it('does not clear the date when the field holds a half-typed date, clears it once the field is empty (TF-4)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')]);
    render(<App api={api} />);
    await screen.findByText('A');
    const input = screen.getByLabelText('Due date for A');
    // Chrome after Backspace in the year: value '' and validity.badInput; jsdom has no partial dates, so emulate it.
    let badInput = true;
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput }) });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(api.calls.update).toEqual([]);
    expect(rowOf('A').querySelector('time')).toHaveTextContent('2026-12-01');

    badInput = false; // the user cleared the rest: an empty field still means "no due date"
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

  it('does not toggle done when the due date is clicked (TF-6)', async () => {
    const api = fakeApi([task(1, 'A', false, '2026-12-01')]);
    render(<App api={api} />);
    await screen.findByText('A');
    await userEvent.click(within(rowOf('A')).getByText('2026-12-01'));
    expect(within(rowOf('A')).getByRole('checkbox')).not.toBeChecked();
    expect(api.calls.update).toEqual([]);
    await userEvent.click(screen.getByText('A'));
    await waitFor(() => expect(within(rowOf('A')).getByRole('checkbox')).toBeChecked());
  });

  describe('overdue (today = 2031-03-05 15:00 local, far from the real clock)', () => {
    // Pinned years away from the real date: an App that ignored `now` and read the clock would fail here (TF-2).
    const now = () => new Date(2031, 2, 5, 15, 0);
    const four = () => [
      task(1, 'Yesterday', false, '2031-03-04'),
      task(2, 'Today', false, '2031-03-05'),
      task(3, 'Tomorrow', false, '2031-03-06'),
      task(4, 'No date'),
    ];
    const showOverdue = () => userEvent.click(screen.getByRole('button', { name: 'Просроченные' }));
    const showAll = () => userEvent.click(screen.getByRole('button', { name: 'Все' }));

    it('marks only open tasks due before today with the overdue class (AC-14)', async () => {
      render(<App api={fakeApi(four())} now={now} />);
      await screen.findByText('Yesterday');
      expect(rowOf('Yesterday')).toHaveClass('overdue');
      expect(rowOf('Today')).not.toHaveClass('overdue');
      expect(rowOf('Tomorrow')).not.toHaveClass('overdue');
      expect(rowOf('No date')).not.toHaveClass('overdue');
    });

    it('has an "Все / Просроченные" switch between the form and the list, "Все" on by default (AC-15)', async () => {
      render(<App api={fakeApi(four())} now={now} />);
      await screen.findByText('Yesterday');
      const all = screen.getByRole('button', { name: 'Все' });
      const overdue = screen.getByRole('button', { name: 'Просроченные' });
      expect(all).toHaveAttribute('aria-pressed', 'true');
      expect(overdue).toHaveAttribute('aria-pressed', 'false');
      const form = screen.getByRole('button', { name: 'Add' }).closest('form')!;
      const group = screen.getByRole('group', { name: 'Filter' });
      const list = screen.getByRole('list');
      expect(form.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(group.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getAllByRole('listitem')).toHaveLength(4);
    });

    it('shows only overdue tasks in "Просроченные" and all of them again in "Все" (AC-16)', async () => {
      render(<App api={fakeApi(four())} now={now} />);
      await screen.findByText('Yesterday');
      await showOverdue();
      expect(screen.getByRole('button', { name: 'Просроченные' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('Yesterday')).toBeInTheDocument();
      await showAll();
      expect(screen.getAllByRole('listitem')).toHaveLength(4);
    });

    it('says "Нет просроченных задач" when nothing is overdue, "No tasks yet." only in "Все" (AC-17)', async () => {
      const { unmount } = render(<App api={fakeApi([task(1, 'Tomorrow', false, '2031-03-06')])} now={now} />);
      await screen.findByText('Tomorrow');
      await showOverdue();
      expect(screen.getByText('Нет просроченных задач')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      unmount();

      render(<App api={fakeApi()} now={now} />);
      await screen.findByText('No tasks yet.');
      await showOverdue();
      expect(screen.getByText('Нет просроченных задач')).toBeInTheDocument();
      expect(screen.queryByText('No tasks yet.')).not.toBeInTheDocument();
      await showAll();
      expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
      expect(screen.queryByText('Нет просроченных задач')).not.toBeInTheDocument();
    });

    it('never treats done tasks as overdue, also after toggling (AC-20)', async () => {
      render(<App api={fakeApi([task(1, 'Old done', true, '2020-01-01'), task(2, 'Late', false, '2031-03-04')])} now={now} />);
      await screen.findByText('Old done');
      expect(rowOf('Old done')).not.toHaveClass('overdue');

      await showOverdue();
      expect(screen.queryByText('Old done')).not.toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      await userEvent.click(within(rowOf('Late')).getByRole('checkbox'));
      await waitFor(() => expect(screen.queryByText('Late')).not.toBeInTheDocument());

      await showAll();
      await userEvent.click(within(rowOf('Late')).getByRole('checkbox'));
      await waitFor(() => expect(rowOf('Late')).toHaveClass('overdue'));
    });

    it('takes "today" from the injected clock, also when it is in the past (TF-2)', async () => {
      // By the real clock 2025-06-01 is long gone; by the injected 2020-01-05 it is still ahead.
      const past = () => new Date(2020, 0, 5, 15, 0);
      render(<App api={fakeApi([task(1, 'Future then', false, '2025-06-01'), task(2, 'Late then', false, '2020-01-04')])} now={past} />);
      await screen.findByText('Future then');
      expect(rowOf('Future then')).not.toHaveClass('overdue');
      expect(rowOf('Late then')).toHaveClass('overdue');
      await showOverdue();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('Late then')).toBeInTheDocument();
    });

    it('keeps the "N open" counter the same in both modes (AC-21)', async () => {
      render(<App api={fakeApi([...four(), task(5, 'Done', true, '2031-03-01')])} now={now} />);
      await screen.findByText('Yesterday');
      expect(screen.getByRole('heading')).toHaveTextContent('Tasks (4 open)');
      await showOverdue();
      expect(screen.getByRole('heading')).toHaveTextContent('Tasks (4 open)');
    });
  });
});
