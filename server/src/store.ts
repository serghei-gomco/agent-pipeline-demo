import type { NewTaskInput, Task, TaskPatch } from './types.js';

// In-memory store. A real app would use a database; for a demo the interface is what matters:
// routes talk to this object only, so swapping it for SQLite later touches one file.
export class TaskStore {
  private tasks = new Map<number, Task>();
  private nextId = 1;

  constructor(private now: () => Date = () => new Date()) {}

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): Task | undefined {
    return this.tasks.get(id);
  }

  create(input: NewTaskInput): Task {
    const task: Task = {
      id: this.nextId++,
      title: input.title,
      done: false,
      createdAt: this.now().toISOString(),
      dueDate: input.dueDate ?? null,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  update(id: number, patch: TaskPatch): Task | undefined {
    const current = this.tasks.get(id);
    if (!current) return undefined;
    const updated: Task = { ...current, ...patch };
    this.tasks.set(id, updated);
    return updated;
  }

  remove(id: number): boolean {
    return this.tasks.delete(id);
  }
}
