import { useEffect, useState, type FormEvent } from 'react';
import { api as realApi, type Api } from './api';
import { filterOverdue, isOverdue } from './overdue';
import { useTasks } from './useTasks';

type Filter = 'all' | 'overdue';

// `now` is injected like `api`, so tests pin "today"; the real app reads the clock on every render.
export function App({ api = realApi, now = () => new Date() }: { api?: Api; now?: () => Date }) {
  const { tasks, loading, error, add, update, remove } = useTasks(api);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const today = now();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await add({ title, dueDate: dueDate || null });
    setTitle('');
    setDueDate('');
  };

  const open = tasks.filter((t) => !t.done).length; // whole list, not the filtered view
  const visible = filter === 'overdue' ? filterOverdue(tasks, today) : tasks;

  return (
    <main className="app">
      <h1>Tasks ({open} open)</h1>

      <form onSubmit={onSubmit} className="add">
        <label htmlFor="new-title">New task</label>
        <input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <label htmlFor="new-due">Due date</label>
        <input id="new-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button type="submit">Add</button>
      </form>

      <div role="group" aria-label="Filter" className="filter">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Все
        </button>
        <button type="button" aria-pressed={filter === 'overdue'} onClick={() => setFilter('overdue')}>
          Просроченные
        </button>
      </div>

      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : filter === 'all' && tasks.length === 0 ? (
        <p>No tasks yet.</p>
      ) : filter === 'overdue' && visible.length === 0 ? (
        <p>Нет просроченных задач</p>
      ) : (
        <ul>
          {visible.map((t) => (
            <li key={t.id} className={isOverdue(t, today) ? 'overdue' : undefined}>
              <label>
                <input type="checkbox" checked={t.done} onChange={() => update(t.id, { done: !t.done })} />
                <span className={t.done ? 'title done' : 'title'}>{t.title}</span>
                {t.dueDate && (
                  <time className="due" dateTime={t.dueDate}>
                    {t.dueDate}
                  </time>
                )}
              </label>
              <DueDateInput
                value={t.dueDate}
                label={`Due date for ${t.title}`}
                onSave={(next) => update(t.id, { dueDate: next })}
              />
              <button onClick={() => remove(t.id)} aria-label={`Delete ${t.title}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// Due date of an existing task. Saved when the field loses focus, not on every change:
// while typing a year Chrome fires a change per digit (0002, 0020, ...), which would send junk dates.
// After a failed save the draft stays in the field and the row keeps showing the old date.
function DueDateInput({
  value,
  label,
  onSave,
}: {
  value: string | null;
  label: string;
  onSave: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const onBlur = () => {
    if (draft === (value ?? '')) return;
    onSave(draft || null); // an empty field means "no due date": send null, never ""
  };

  return (
    <input type="date" aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={onBlur} />
  );
}
