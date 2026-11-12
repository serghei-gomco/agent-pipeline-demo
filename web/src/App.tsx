import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { api as realApi, type Api } from './api';
import { filterOverdue, isOverdue } from './overdue';
import { useTasks } from './useTasks';

type Filter = 'all' | 'overdue';

// `now` is injected like `api`, so tests pin "today"; the real app reads the clock on every render.
export function App({ api = realApi, now = () => new Date() }: { api?: Api; now?: () => Date }) {
  const { tasks, loading, error, add, update, remove } = useTasks(api);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueError, setDueError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const today = now();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    // A half-typed date reads as '' in Chrome; sending it would create the task without a due date (TF-4 twin).
    const dueField = e.currentTarget.querySelector<HTMLInputElement>('#new-due');
    if (dueField?.validity.badInput) {
      setDueError('Enter a complete due date or clear the field.');
      return; // keep both fields as typed
    }
    setDueError(null);
    if (!(await add({ title, dueDate: dueDate || null }))) return; // failed: keep both fields for a retry
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
      {dueError && <p role="alert">{dueError}</p>}

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
              {/* The date sits outside the checkbox label: a click on it must not toggle "done". */}
              <span className="item">
                <label>
                  <input type="checkbox" checked={t.done} onChange={() => update(t.id, { done: !t.done })} />
                  <span className={t.done ? 'title done' : 'title'}>{t.title}</span>
                </label>
                {t.dueDate && (
                  <time className="due" dateTime={t.dueDate}>
                    {t.dueDate}
                  </time>
                )}
              </span>
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
// The draft follows `value` (any update answer replaces the task, and the date may have been changed elsewhere),
// but only while the field holds no unsaved input: a save answered while the user is typing again must not wipe
// the new input (TF-8), and a field left stale would send the old date back on the next blur (F-7).
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
  const edited = useRef(false); // set by typing, cleared on blur: true while the field holds unsaved input

  useEffect(() => {
    if (!edited.current) setDraft(value ?? '');
  }, [value]);

  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    // A half-typed date (e.g. Backspace in the year) reads as '' in Chrome, but it is not a request to clear: keep the date.
    if (e.currentTarget.validity.badInput) return; // still unsaved input: keep `edited`
    edited.current = false;
    if (draft === (value ?? '')) return;
    onSave(draft || null); // an empty field means "no due date": send null, never ""
  };

  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      onChange={(e) => {
        edited.current = true;
        setDraft(e.target.value);
      }}
      onBlur={onBlur}
    />
  );
}
