import express, { type Request, type Response } from 'express';
import { TaskStore } from './store.js';
import { validateNewTask, validatePatch } from './validate.js';

// createApp() builds the Express app without listening on a port,
// so tests can call it through supertest and every test gets a fresh store.
export function createApp(store: TaskStore = new TaskStore()) {
  const app = express();
  app.use(express.json());

  const parseId = (req: Request): number | undefined => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : undefined;
  };

  app.get('/api/tasks', (_req, res) => {
    res.json(store.list());
  });

  app.post('/api/tasks', (req, res) => {
    const result = validateNewTask(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    res.status(201).json(store.create(result.value));
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const id = parseId(req);
    if (id === undefined) return res.status(400).json({ errors: ['id must be a positive integer'] });
    const result = validatePatch(req.body);
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    const task = store.update(id, result.value);
    if (!task) return res.status(404).json({ errors: ['task not found'] });
    res.json(task);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const id = parseId(req);
    if (id === undefined) return res.status(400).json({ errors: ['id must be a positive integer'] });
    if (!store.remove(id)) return res.status(404).json({ errors: ['task not found'] });
    res.status(204).end();
  });

  // Malformed JSON from express.json() lands here: answer 400 instead of an HTML stack trace.
  app.use((err: Error & { type?: string }, _req: Request, res: Response, next: (e?: unknown) => void) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['invalid JSON'] });
    next(err);
  });

  return app;
}
