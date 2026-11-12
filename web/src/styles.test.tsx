import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Api } from './api';
import { App } from './App';

// jsdom does no layout, but it does apply stylesheet rules in getComputedStyle.
// So these tests pin the CSS rules behind the visible fixes; the layout itself is checked in Chrome at 375 px.
// Read from disk: Vitest replaces imported CSS (also `?raw`) with an empty string.
const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
});
afterEach(() => style.remove());

const api: Api = {
  list: async () => [{ id: 1, title: 'A', done: false, createdAt: '2026-11-12T10:00:00.000Z', dueDate: '2026-12-01' }],
  create: async () => {
    throw new Error('not used');
  },
  update: async () => {
    throw new Error('not used');
  },
  remove: async () => undefined,
};

const look = (el: Element) => {
  const s = getComputedStyle(el);
  return { background: s.backgroundColor, color: s.color, fontWeight: s.fontWeight, border: s.borderColor };
};

describe('styles', () => {
  it('shows the active filter mode differently from the inactive one (BUG-2)', async () => {
    render(<App api={api} />);
    await screen.findByText('A');
    const all = screen.getByRole('button', { name: 'Все' });
    const overdue = screen.getByRole('button', { name: 'Просроченные' });
    expect(look(all)).not.toEqual(look(overdue));
    const active = look(all);
    const inactive = look(overdue);

    await userEvent.click(overdue);
    expect(look(overdue)).toEqual(active);
    expect(look(all)).toEqual(inactive);
  });

  it('lets the create form wrap and keeps the due date on one line (BUG-1)', async () => {
    render(<App api={api} />);
    await screen.findByText('A');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Add' }).closest('form')!).flexWrap).toBe('wrap');
    const due = screen.getByText('2026-12-01');
    expect(getComputedStyle(due).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(due).display).toBe('inline-block');
  });
});
