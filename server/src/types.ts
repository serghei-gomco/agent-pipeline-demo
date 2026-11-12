// Shared shape of a task. The web app imports this file too, so the API and the UI cannot drift apart.
export interface Task {
  id: number;
  title: string;
  done: boolean;
  createdAt: string; // ISO timestamp, set by the server
  dueDate: string | null; // calendar date YYYY-MM-DD without time; null = no due date
}

export interface NewTaskInput {
  title: string;
  dueDate?: string | null;
}

export interface TaskPatch {
  title?: string;
  done?: boolean;
  dueDate?: string | null; // missing = keep, null = clear
}

export const TITLE_MAX = 120;
