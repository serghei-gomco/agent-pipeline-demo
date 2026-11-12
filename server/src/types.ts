// Shared shape of a task. The web app imports this file too, so the API and the UI cannot drift apart.
export interface Task {
  id: number;
  title: string;
  done: boolean;
  createdAt: string; // ISO timestamp, set by the server
}

export interface NewTaskInput {
  title: string;
}

export interface TaskPatch {
  title?: string;
  done?: boolean;
}

export const TITLE_MAX = 120;
