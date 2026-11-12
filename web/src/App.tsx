import { useState, type FormEvent } from 'react';
import { api as realApi, type Api } from './api';
import { useTasks } from './useTasks';

export function App({ api = realApi }: { api?: Api }) {
  const { tasks, loading, error, add, update, remove } = useTasks(api);
  const [title, setTitle] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await add(title);
    setTitle('');
  };

  const open = tasks.filter((t) => !t.done).length;

  return (
    <main className="app">
      <h1>Tasks ({open} open)</h1>

      <form onSubmit={onSubmit} className="add">
        <label htmlFor="new-title">New task</label>
        <input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <button type="submit">Add</button>
      </form>

      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : tasks.length === 0 ? (
        <p>No tasks yet.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              <label>
                <input type="checkbox" checked={t.done} onChange={() => update(t.id, { done: !t.done })} />
                <span className={t.done ? 'done' : undefined}>{t.title}</span>
              </label>
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
