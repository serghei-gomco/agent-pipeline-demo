// QC-87 follow-up: who stops the submit of a half-typed date (Chrome native validation vs app alert),
// positive control for the "complete the date" path, and QC-69 unbroken-title diagnosis.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
const EV = './.tasks/T-20261112-1-due-dates-overdue/evidence';
const BASE = 'http://localhost:5173', API = 'http://localhost:3001';
async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null };
}
async function reset() { const { body } = await api('GET', '/api/tasks'); for (const t of body) await api('DELETE', `/api/tasks/${t.id}`); }
const settle = (p) => p.waitForLoadState('networkidle').then(() => p.waitForTimeout(200));
const out = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const locale of ['en-US', 'ru-RU']) {
  await reset();
  const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  const posts = []; p.on('request', (r) => { if (r.url().includes('/api/') && r.method() === 'POST') posts.push(r.postData()); });
  await p.goto(BASE); await settle(p);
  await p.evaluate(() => {
    window.__ev = [];
    const f = document.querySelector('form');
    f.addEventListener('submit', () => window.__ev.push('submit'), true);
    document.querySelector('#new-due').addEventListener('invalid', (e) => window.__ev.push('invalid:' + e.target.validationMessage), true);
  });
  const due = p.locator('#new-due');
  await p.fill('#new-title', 'Half'); await due.click({ position: { x: 8, y: 8 } }); await due.pressSequentially('0101', { delay: 60 });
  const r = { locale };
  r.before = await p.evaluate(() => ({ badInput: document.querySelector('#new-due').validity.badInput, formValid: document.querySelector('form').checkValidity(), novalidate: document.querySelector('form').noValidate }));
  await p.evaluate(() => (window.__ev = [])); // checkValidity above fires 'invalid' too; reset
  await p.click('button[type=submit]'); await settle(p);
  r.afterClick = await p.evaluate(() => ({ events: window.__ev, active: document.activeElement?.id, alerts: [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent) }));
  r.postsAfterHalf = posts.length;
  // positive control for the instrument: complete the date -> submit fires, no invalid, POST with date
  await due.click({ position: { x: 8, y: 8 } }); await due.pressSequentially('01012027', { delay: 60 });
  r.completed = await due.evaluate((el) => ({ value: el.value, badInput: el.validity.badInput }));
  await p.evaluate(() => (window.__ev = []));
  await p.click('button[type=submit]'); await settle(p);
  r.afterValid = await p.evaluate(() => ({ events: window.__ev, alerts: [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent) }));
  r.posts = posts;
  r.timeInRow = await p.locator('li', { hasText: 'Half' }).locator('time').textContent().catch(() => null);
  out[locale] = r; await ctx.close();
}
// QC-69 unbroken title: overflow with and without the elements added by the task
await reset();
const t120 = ('L'.repeat(60) + 'ДлинноеНазвание'.repeat(4)).slice(0, 120);
await api('POST', '/api/tasks', { title: t120, dueDate: '2026-11-13' });
out.qc69unbroken = {};
for (const w of [1280, 375]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } }); const p = await ctx.newPage(); await p.goto(BASE); await settle(p);
  out.qc69unbroken[w] = await p.evaluate(() => {
    const res = { vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth };
    document.querySelectorAll('li input[type=date], li time').forEach((e) => (e.style.display = 'none'));
    res.scrollWWithoutTaskElements = document.documentElement.scrollWidth;
    return res;
  });
  await ctx.close();
}
await browser.close();
writeFileSync(`${EV}/r1-QC-87b.txt`, JSON.stringify(out, null, 2) + '\n'); console.log(JSON.stringify(out, null, 2));
