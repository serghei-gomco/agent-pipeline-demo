// QC-86: second engines. Playwright 1.42.1 (cached) -> firefox-1440 is installed; webkit-1983 is not.
import { createRequire } from 'module'; import { writeFileSync } from 'fs'; const require = createRequire(import.meta.url);
const pw = require('~/.npm/_npx/3f0dbe1f1e78f6d0/node_modules/playwright');
const EV = './.tasks/T-20261112-1-due-dates-overdue/evidence';
const API = 'http://localhost:3001', BASE = 'http://localhost:5173', RED = 'rgb(198, 40, 40)';
const engine = process.argv[2];
const api = async (m, path, body) => { const r = await fetch(API + path, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const o = { engine };
try {
  for (const t of await api('GET', '/api/tasks')) await api('DELETE', `/api/tasks/${t.id}`);
  const b = await pw[engine].launch(); o.version = b.version();
  const p = await (await b.newContext()).newPage(); const net = [], cons = [];
  p.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') net.push({ m: r.method(), body: r.postData() }); });
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) cons.push(m.text()); });
  await p.goto(BASE); await p.waitForLoadState('networkidle');
  await p.fill('#new-title', 'FF'); await p.fill('#new-due', '2026-11-11'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
  const row = p.locator('li', { has: p.locator('.title', { hasText: /^FF$/ }) });
  o.created = { time: await row.locator('time').textContent(), fields: [await p.inputValue('#new-title'), await p.inputValue('#new-due')] };
  o.overdueColor = { title: await row.locator('.title').evaluate((e) => getComputedStyle(e).color), time: await row.locator('time').evaluate((e) => getComputedStyle(e).color) };
  await p.fill('#new-title', 'FF2'); await p.fill('#new-due', '2026-11-13'); await p.click('button[type=submit]'); await p.waitForTimeout(500);
  const row2 = p.locator('li', { has: p.locator('.title', { hasText: /^FF2$/ }) });
  o.notOverdueColor = await row2.locator('.title').evaluate((e) => getComputedStyle(e).color);
  await p.getByRole('button', { name: 'Просроченные' }).click(); o.overdueMode = await p.$$eval('li .title', (e) => e.map((x) => x.textContent));
  await p.getByRole('button', { name: 'Все' }).click(); o.allMode = await p.locator('li').count();
  const inp = p.getByLabel('Due date for FF2');
  await inp.fill('2027-01-15'); await p.locator('h1').click(); await p.waitForTimeout(500);
  await inp.fill(''); await p.locator('h1').click(); await p.waitForTimeout(500);
  await p.reload(); await p.waitForLoadState('networkidle');
  o.afterF5Time = await p.locator('li', { has: p.locator('.title', { hasText: /^FF2$/ }) }).locator('time').count();
  o.requests = net; o.consoleErrors = cons;
  await p.screenshot({ path: `${EV}/QC-86-${engine}.png` });
  const patches = net.filter((x) => x.m === 'PATCH').map((x) => x.body);
  o.status = o.created.time === '2026-11-11' && o.created.fields.join('') === '' && o.overdueColor.title === RED && o.overdueColor.time === RED && o.notOverdueColor !== RED &&
    JSON.stringify(o.overdueMode) === '["FF"]' && o.allMode === 2 && JSON.stringify(patches) === JSON.stringify(['{"dueDate":"2027-01-15"}', '{"dueDate":null}']) && o.afterF5Time === 0 ? 'PASS' : 'FAIL';
  await b.close();
} catch (e) { o.status = 'ERROR'; o.error = String(e.message || e).slice(0, 800); }
writeFileSync(`${EV}/QC-86-${engine}.txt`, JSON.stringify(o, null, 2)); console.log(engine, o.status, o.error ?? '');
