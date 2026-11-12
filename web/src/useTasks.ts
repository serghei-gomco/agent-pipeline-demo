import { useCallback, useEffect, useState } from 'react';
import type { NewTaskInput, Task, TaskPatch } from '../../server/src/types';
import type { Api } from './api';

// All task state lives in this hook. Components get data + actions and never call fetch themselves.
// The api object is injected, so tests pass a fake instead of mocking global fetch.
export function useTasks(api: Api) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false; // ignore the answer if the component unmounted meanwhile
    api
      .list()
      .then((list) => !cancelled && setTasks(list))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Every action clears the old error first and reports a new one if the call fails.
  // Resolves to true on success, so callers can keep user input when the call failed.
  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  const add = (input: NewTaskInput) =>
    run(async () => {
      const task = await api.create(input);
      setTasks((prev) => [...prev, task]);
    });

  const update = (id: number, patch: TaskPatch) =>
    run(async () => {
      const task = await api.update(id, patch);
      setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
    });

  const remove = (id: number) =>
    run(async () => {
      await api.remove(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });

  return { tasks, loading, error, add, update, remove };
}
