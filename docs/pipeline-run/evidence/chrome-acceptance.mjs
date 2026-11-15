// Acceptance run, Chrome (Playwright 1.66 channel=chrome). Writes evidence/QC-n.txt|png.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');

const EV = './.tasks/T-20261112-1-due-dates-overdue/evidence';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';
const D_TODAY = '2026-11-12', D_YESTERDAY = '2026-11-11', D_TOMORROW = '2026-11-13';
const RED = 'rgb(198, 40, 40)';
const only = process.argv[2] ? process.argv[2].split(',') : null;

const results = [];
const consoleLog = []; // QC-80
const ev = (id, obj) => writeFileSync(`${EV}/${id}.txt`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
async function reset() {
  const { body } = await api('GET', '/api/tasks');
  for (const t of body) await api('DELETE', `/api/tasks/${t.id}`);
}
function track(page, tag) {
  const net = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) net.push({ m: r.method(), url: r.url().replace(BASE, ''), body: r.postData() ?? null }); });
  page.on('response', (r) => { if (r.url().includes('/api/')) net.push({ resp: r.status(), m: r.request().method(), url: r.url().replace(BASE, '') }); });
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) net.push({ failed: r.failure()?.errorText, m: r.method(), url: r.url().replace(BASE, '') }); });
  page.on('console', (m) => consoleLog.push({ tag, type: m.type(), text: m.text(), url: m.location()?.url }));
  page.on('pageerror', (e) => consoleLog.push({ tag, type: 'pageerror', text: String(e) }));
  return net;
}
const row = (page, title) => page.locator('li', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
const color = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
const blurByClick = (page) => page.locator('h1').click();
const settle = (page) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(150));

async function run(id, fn) {
  if (only && !only.includes(id)) return;
  const out = { id };
  try { await fn(out); } catch (e) { out.status = 'ERROR'; out.error = String(e.stack || e); }
  results.push(out); ev(id, out); console.log(id, out.status, out.note ?? '');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const newCtx = (opts = {}) => browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, ...opts });

// QC-80 positive control first
await run('QC-80-control', async (o) => {
  const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'control');
  await p.goto(BASE); await p.evaluate(() => console.error('qa-probe'));
  await p.waitForTimeout(100);
  o.captured = consoleLog.some((m) => m.text === 'qa-probe');
  o.status = o.captured ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-10', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-10');
  await p.goto(BASE); await settle(p);
  const h = []; h.push(await p.textContent('h1'));
  await p.fill('#new-title', 'Plain'); await p.click('button[type=submit]'); await settle(p);
  h.push(await p.textContent('h1')); o.timeShown = await row(p, 'Plain').locator('time').count();
  await row(p, 'Plain').locator('input[type=checkbox]').click(); await settle(p); h.push(await p.textContent('h1'));
  await row(p, 'Plain').locator('input[type=checkbox]').click(); await settle(p); h.push(await p.textContent('h1'));
  await p.click('button[aria-label="Delete Plain"]'); await settle(p); h.push(await p.textContent('h1'));
  o.emptyText = await p.locator('text=No tasks yet.').count();
  o.headers = h; o.alert = await p.locator('[role=alert]').count(); o.net = net;
  const ok = JSON.stringify(h) === JSON.stringify(['Tasks (0 open)', 'Tasks (1 open)', 'Tasks (0 open)', 'Tasks (1 open)', 'Tasks (0 open)']) && o.emptyText === 1 && o.alert === 0 && o.timeShown === 0;
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-10.png` }); await ctx.close();
});

let uiAfter37_38 = null;
await run('QC-38', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-38');
  await p.goto(BASE); await settle(p);
  await p.fill('#new-title', 'WithDate'); await p.fill('#new-due', D_TOMORROW); await p.click('button[type=submit]'); await settle(p);
  o.fieldsAfterAdd = { title: await p.inputValue('#new-title'), due: await p.inputValue('#new-due') };
  await p.fill('#new-title', 'NoDate'); await p.click('button[type=submit]'); await settle(p);
  o.posts = net.filter((x) => x.m === 'POST');
  await p.reload(); await settle(p);
  o.afterF5 = { WithDate: await row(p, 'WithDate').locator('time').textContent().catch(() => null), NoDateTime: await row(p, 'NoDate').locator('time').count(), rows: await p.locator('li').count() };
  const bodies = o.posts.filter((x) => x.body).map((x) => JSON.parse(x.body));
  const statuses = o.posts.filter((x) => x.resp).map((x) => x.resp);
  const ok = bodies.length === 2 && bodies[0].dueDate === D_TOMORROW && (bodies[1].dueDate === null || !('dueDate' in bodies[1])) &&
    statuses.join() === '201,201' && o.afterF5.WithDate === D_TOMORROW && o.afterF5.NoDateTime === 0 && o.afterF5.rows === 2 &&
    o.fieldsAfterAdd.title === '' && o.fieldsAfterAdd.due === '';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-38.png` }); await ctx.close();
});

await run('QC-37', async (o) => {
  // keep QC-38 data, add own task
  const c = await api('POST', '/api/tasks', { title: 'Edit me', dueDate: '2026-12-01' }); const id = c.body.id;
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-37');
  await p.goto(BASE); await settle(p);
  const inp = p.getByLabel('Due date for Edit me');
  await inp.fill('2027-01-15'); await blurByClick(p); await settle(p);
  await p.reload(); await settle(p);
  o.afterFirstF5 = { time: await row(p, 'Edit me').locator('time').textContent().catch(() => null), input: await p.getByLabel('Due date for Edit me').inputValue() };
  await p.getByLabel('Due date for Edit me').fill(''); await blurByClick(p); await settle(p);
  await p.reload(); await settle(p);
  o.afterSecondF5 = { timeCount: await row(p, 'Edit me').locator('time').count(), input: await p.getByLabel('Due date for Edit me').inputValue() };
  o.patches = net.filter((x) => x.m === 'PATCH');
  const reqs = o.patches.filter((x) => 'body' in x);
  const ok = reqs.length === 2 && reqs.every((r) => r.url === `/api/tasks/${id}`) && reqs[0].body === '{"dueDate":"2027-01-15"}' && reqs[1].body === '{"dueDate":null}' &&
    o.afterFirstF5.time === '2027-01-15' && o.afterSecondF5.timeCount === 0 && o.afterSecondF5.input === '';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-37.png` });
  uiAfter37_38 = await p.$$eval('li', (lis) => lis.map((li) => ({ title: li.querySelector('.title').textContent, due: li.querySelector('time')?.textContent ?? null })));
  await ctx.close();
});

await run('QC-78', async (o) => {
  const out = execSync(`curl -s ${API}/api/tasks`).toString(); o.curl = out; o.ui = uiAfter37_38;
  const apiList = JSON.parse(out).map((t) => ({ title: t.title, due: t.dueDate }));
  o.match = JSON.stringify(apiList) === JSON.stringify(uiAfter37_38);
  o.status = o.match && apiList.length === 3 ? 'PASS' : 'FAIL';
});

await run('QC-26', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Yest', dueDate: D_YESTERDAY }); await api('POST', '/api/tasks', { title: 'Tomo', dueDate: D_TOMORROW });
  const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'QC-26'); await p.goto(BASE); await settle(p);
  o.yest = { title: await color(row(p, 'Yest').locator('.title')), time: await color(row(p, 'Yest').locator('time')), cls: await row(p, 'Yest').getAttribute('class') };
  o.tomo = { title: await color(row(p, 'Tomo').locator('.title')), time: await color(row(p, 'Tomo').locator('time')), cls: await row(p, 'Tomo').getAttribute('class') };
  o.browserNow = await p.evaluate(() => new Date().toString());
  const ok = o.yest.title === RED && o.yest.time === RED && o.tomo.title === 'rgb(29, 29, 31)' && o.tomo.time === 'rgb(29, 29, 31)';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-26.png` }); await ctx.close();
});

await run('QC-73', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Late', dueDate: D_YESTERDAY });
  const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'QC-73'); await p.goto(BASE); await settle(p);
  o.before = { title: await color(row(p, 'Late').locator('.title')), time: await color(row(p, 'Late').locator('time')) };
  await row(p, 'Late').locator('input[type=checkbox]').click(); await settle(p);
  const t = row(p, 'Late').locator('.title');
  o.done = { title: await color(t), deco: await t.evaluate((el) => getComputedStyle(el).textDecorationLine), time: await color(row(p, 'Late').locator('time')), cls: await row(p, 'Late').getAttribute('class') };
  await p.getByRole('button', { name: 'Просроченные' }).click(); await settle(p);
  o.doneInOverdue = await p.locator('li').count(); o.emptyMsg = await p.locator('text=Нет просроченных задач').count();
  await p.screenshot({ path: `${EV}/QC-73-done-overdue-mode.png` });
  await p.getByRole('button', { name: 'Все' }).click();
  await row(p, 'Late').locator('input[type=checkbox]').click(); await settle(p);
  o.after = { title: await color(row(p, 'Late').locator('.title')), time: await color(row(p, 'Late').locator('time')) };
  await p.getByRole('button', { name: 'Просроченные' }).click(); o.reopenedInOverdue = await p.locator('li').count();
  const ok = o.before.title === RED && o.done.title === 'rgb(142, 142, 147)' && o.done.deco === 'line-through' && o.done.time !== RED &&
    o.doneInOverdue === 0 && o.emptyMsg === 1 && o.after.title === RED && o.after.time === RED && o.reopenedInOverdue === 1;
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-73.png` }); await ctx.close();
});

async function tzCase(o, id, tz, nowUtc, dRed, dNot) {
  await reset(); await api('POST', '/api/tasks', { title: 'RedOne', dueDate: dRed }); await api('POST', '/api/tasks', { title: 'NotRed', dueDate: dNot });
  const ctx = await newCtx({ timezoneId: tz }); const p = await ctx.newPage(); track(p, id);
  await p.clock.setFixedTime(new Date(nowUtc));
  await p.goto(BASE); await settle(p);
  o.browser = await p.evaluate(() => ({ now: new Date().toString(), iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  o.red = { title: await color(row(p, 'RedOne').locator('.title')), time: await color(row(p, 'RedOne').locator('time')) };
  o.not = { title: await color(row(p, 'NotRed').locator('.title')), time: await color(row(p, 'NotRed').locator('time')) };
  await p.getByRole('button', { name: 'Просроченные' }).click();
  o.overdueMode = await p.$$eval('li .title', (els) => els.map((e) => e.textContent));
  await p.screenshot({ path: `${EV}/${id}.png` });
  const ok = o.browser.tz === tz && o.red.title === RED && o.red.time === RED && o.not.title !== RED && o.not.time !== RED && JSON.stringify(o.overdueMode) === '["RedOne"]';
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
}
await run('QC-71', (o) => tzCase(o, 'QC-71', 'Europe/Chisinau', '2026-11-11T22:30:00Z', '2026-11-11', '2026-11-12'));
await run('QC-72', (o) => tzCase(o, 'QC-72', 'America/New_York', '2026-11-12T04:30:00Z', '2026-11-10', '2026-11-11'));

await run('QC-70', async (o) => {
  // machine/browser TZ = Europe/Chisinau (EET). Local 2026-11-12 23:59 = 21:59Z
  await reset(); await api('POST', '/api/tasks', { title: 'DueToday', dueDate: D_TODAY }); await api('POST', '/api/tasks', { title: 'Other' });
  const ctx = await newCtx({ timezoneId: 'Europe/Chisinau' }); const p = await ctx.newPage(); track(p, 'QC-70');
  await p.clock.setFixedTime(new Date('2026-11-12T21:59:00Z'));
  await p.goto(BASE); await settle(p);
  o.t1 = await p.evaluate(() => new Date().toString());
  o.before = await color(row(p, 'DueToday').locator('.title'));
  await p.clock.setFixedTime(new Date('2026-11-12T22:01:00Z'));
  await p.waitForTimeout(2000);
  o.t2 = await p.evaluate(() => new Date().toString());
  o.afterMidnightNoAction = await color(row(p, 'DueToday').locator('.title'));
  await row(p, 'Other').locator('input[type=checkbox]').click(); await settle(p);
  o.afterAction = await color(row(p, 'DueToday').locator('.title'));
  const ok = o.before !== RED && o.afterMidnightNoAction !== RED && o.afterAction === RED;
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-70.png` }); await ctx.close();
});

await run('QC-68', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Typed', dueDate: '2026-12-01' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-68'); await p.goto(BASE); await settle(p);
  const inp = p.getByLabel('Due date for Typed');
  const patches = () => net.filter((x) => x.m === 'PATCH' && 'body' in x);
  // (a) focus and leave without edit
  await inp.focus(); await blurByClick(p); await settle(p); o.a = patches().length;
  // (b) type digit by digit (en-US: mm dd yyyy)
  await inp.click({ position: { x: 8, y: 8 } });
  o.focusedSegmentNote = 'Chrome uses OS locale ru: дд.мм.гггг; click at left edge = day segment';
  await inp.pressSequentially('20012027', { delay: 60 }); o.valueTyped = await inp.inputValue();
  await blurByClick(p); await settle(p); o.b = patches().map((x) => x.body);
  // (c) change and revert, leave
  const n0 = patches().length; await inp.fill('2027-03-03'); await inp.fill(o.valueTyped); await blurByClick(p); await settle(p); o.c = patches().length - n0;
  o.time = await row(p, 'Typed').locator('time').textContent();
  const ok = o.a === 0 && o.b.length === 1 && o.b[0] === '{"dueDate":"2027-01-20"}' && o.c === 0 && o.time === '2027-01-20';
  o.status = ok ? 'PASS' : 'FAIL'; o.net = net; await ctx.close();
});

await run('QC-75-live', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'K', dueDate: D_YESTERDAY }); await api('POST', '/api/tasks', { title: 'K2', dueDate: D_TOMORROW });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-75'); await p.goto(BASE); await settle(p);
  const all = p.getByRole('button', { name: 'Все' }), od = p.getByRole('button', { name: 'Просроченные' });
  const st = async () => [await all.getAttribute('aria-pressed'), await od.getAttribute('aria-pressed'), await p.locator('li').count()];
  o.initial = await st();
  await p.focus('#new-title'); await p.keyboard.type('draft'); // a draft in the form
  const tabs = []; for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => document.activeElement?.textContent || document.activeElement?.id); tabs.push(f); if (f === 'Просроченные') break; }
  o.tabPath = tabs;
  await p.keyboard.press('Enter'); await settle(p); o.afterEnter = await st();
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Space'); await settle(p); o.afterSpaceOnAll = await st();
  await p.keyboard.press('Tab'); await p.keyboard.press('Space'); await settle(p); o.afterSpaceOnOverdue = await st();
  o.posts = net.filter((x) => x.m === 'POST').length; o.titleDraft = await p.inputValue('#new-title');
  const ok = JSON.stringify(o.initial) === '["true","false",2]' && JSON.stringify(o.afterEnter) === '["false","true",1]' &&
    JSON.stringify(o.afterSpaceOnAll) === '["true","false",2]' && JSON.stringify(o.afterSpaceOnOverdue) === '["false","true",1]' && o.posts === 0 && o.titleDraft === 'draft';
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-84', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'QC-84'); await p.goto(BASE); await settle(p);
  const sty = (name) => p.getByRole('button', { name }).evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, border: s.border, fw: s.fontWeight, outline: s.outline, deco: s.textDecorationLine, shadow: s.boxShadow }; });
  o.allActive = { all: await sty('Все'), overdue: await sty('Просроченные') };
  await p.locator('.filter').screenshot({ path: `${EV}/QC-84-all-active.png` });
  await p.getByRole('button', { name: 'Просроченные' }).click(); await p.locator('h1').click();
  o.overdueActive = { all: await sty('Все'), overdue: await sty('Просроченные') };
  await p.locator('.filter').screenshot({ path: `${EV}/QC-84-overdue-active.png` });
  o.distinguishable = JSON.stringify(o.allActive.all) !== JSON.stringify(o.allActive.overdue);
  o.status = o.distinguishable ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-85', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Просроченная задача', dueDate: D_YESTERDAY }); await api('POST', '/api/tasks', { title: 'Обычная', dueDate: D_TOMORROW });
  const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'QC-85'); await p.goto(BASE); await settle(p);
  await p.screenshot({ path: `${EV}/QC-85-all.png` });
  o.buttons = await p.$$eval('.filter button', (b) => b.map((x) => x.textContent));
  await p.getByRole('button', { name: 'Просроченные' }).click(); await row(p, 'Просроченная задача').locator('input[type=checkbox]').click(); await settle(p);
  o.emptyText = await p.locator('p', { hasText: 'Нет просроченных задач' }).textContent();
  await p.screenshot({ path: `${EV}/QC-85-empty.png` });
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const L1 = lum(0xf7, 0xf7, 0xf8), L2 = lum(0xc6, 0x28, 0x28); o.contrast = +((L1 + 0.05) / (L2 + 0.05)).toFixed(2);
  const ok = JSON.stringify(o.buttons) === '["Все","Просроченные"]' && o.emptyText === 'Нет просроченных задач' && o.contrast >= 4.5;
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-69', async (o) => {
  await reset();
  const long = 'L'.repeat(60) + 'ДлинноеНазвание'.repeat(4); const t120 = long.slice(0, 120);
  const spaced = ('Оплатить счёт за аренду офиса и согласовать новый договор с арендодателем до конца месяца, иначе штраф и пени '.repeat(2)).slice(0, 120);
  o.titles = { spacedLen: spaced.length, unbrokenLen: t120.length };
  const which = process.env.QC69 || 'both';
  const list = which === 'spaced' ? [spaced, 'Кириллица и эмодзи 🎉🚀 задача', 'Short'] : which === 'unbroken' ? [t120, 'Short'] : [spaced, t120, 'Кириллица и эмодзи 🎉🚀 задача', 'Short'];
  for (const t of list) await api('POST', '/api/tasks', { title: t, dueDate: D_TOMORROW });
  o.widths = {};
  for (const w of [1280, 375]) {
    const ctx = await newCtx({ viewport: { width: w, height: 800 } }); const p = await ctx.newPage(); track(p, 'QC-69'); await p.goto(BASE); await settle(p);
    o.widths[w] = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const rows = [...document.querySelectorAll('li')].map((li) => {
        const r = (el) => el?.getBoundingClientRect();
        const lab = r(li.querySelector('label')), time = r(li.querySelector('time')), inp = r(li.querySelector('input[type=date]')), btn = r(li.querySelector('button'));
        return { aria: li.querySelector('input[type=date]').getAttribute('aria-label').slice(0, 30), timeRight: time.right, inpLeft: inp.left, inpRight: inp.right, btnRight: btn.right, labelRight: lab.right,
          overlapTimeInput: time.right > inp.left + 0.5, offscreen: inp.right > vw || btn.right > vw, timeSameLineAsTitle: Math.abs(time.top - r(li.querySelector('.title')).top) < 20 };
      });
      const res = { vw, scrollW: document.documentElement.scrollWidth, hScroll: document.documentElement.scrollWidth > vw, rows };
      // diagnosis: same page without the new elements (date input + <time>) — is overflow pre-existing?
      document.querySelectorAll('li input[type=date], li time').forEach((e) => (e.style.display = 'none'));
      res.scrollWWithoutNewElements = document.documentElement.scrollWidth;
      document.querySelectorAll('li input[type=date], li time').forEach((e) => (e.style.display = ''));
      return res;
    });
    await p.screenshot({ path: `${EV}/QC-69-${process.env.QC69 || 'both'}-${w}.png`, fullPage: true }); await ctx.close();
  }
  const bad = Object.values(o.widths).some((x) => x.hScroll || x.rows.some((r) => r.offscreen || r.overlapTimeInput || !r.timeSameLineAsTitle));
  o.status = bad ? 'FAIL' : 'PASS';
});

await run('QC-46', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Existing' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-46'); await p.goto(BASE); await settle(p);
  const h0 = await p.textContent('h1');
  await p.fill('#new-title', 'A');
  await p.locator('#new-due').click({ position: { x: 8, y: 8 } });
  await p.locator('#new-due').pressSequentially('010120261', { delay: 60 });
  o.fieldValue = await p.inputValue('#new-due');
  await p.click('button[type=submit]'); await settle(p);
  o.post = net.filter((x) => x.m === 'POST');
  o.alert = await p.locator('[role=alert]').textContent().catch(() => null);
  o.rowA = await row(p, 'A').count(); o.h = [h0, await p.textContent('h1')];
  o.fieldsAfter = { title: await p.inputValue('#new-title'), due: await p.inputValue('#new-due') };
  // positive control: valid create works in same session
  await p.fill('#new-due', D_TOMORROW); await p.click('button[type=submit]'); await settle(p); o.controlRowA = await row(p, 'A').count();
  await p.screenshot({ path: `${EV}/QC-46.png` });
  const ok = o.fieldValue === '20261-01-01' && o.post.some((x) => x.resp === 400) && (o.alert ?? '').includes('dueDate must be a date in YYYY-MM-DD format') && o.rowA === 0 && o.h[0] === o.h[1] && o.controlRowA === 1;
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-47', async (o) => {
  await reset(); const c = await api('POST', '/api/tasks', { title: 'Gone', dueDate: '2026-12-01' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-47'); await p.goto(BASE); await settle(p);
  o.curl = execSync(`curl -s -o /dev/null -w '%{http_code}' -X DELETE ${API}/api/tasks/${c.body.id}`).toString();
  await p.getByLabel('Due date for Gone').fill('2027-02-02'); await blurByClick(p); await settle(p);
  o.alert = await p.locator('[role=alert]').textContent().catch(() => null);
  o.time = await row(p, 'Gone').locator('time').textContent().catch(() => null); o.h1 = await p.textContent('h1');
  o.net = net.filter((x) => x.m === 'PATCH');
  await p.screenshot({ path: `${EV}/QC-47.png` });
  const ok = o.curl === '204' && o.alert === 'task not found' && o.time === '2026-12-01';
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-48', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Net', dueDate: '2026-12-01' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-48'); await p.goto(BASE); await settle(p);
  await p.route('**/api/tasks/*', (r) => r.abort());
  const inp = p.getByLabel('Due date for Net');
  await inp.fill('2027-01-15'); await blurByClick(p); await p.waitForTimeout(500);
  o.duringAbort = { alert: await p.locator('[role=alert]').textContent().catch(() => null), time: await row(p, 'Net').locator('time').textContent(), input: await inp.inputValue() };
  await p.screenshot({ path: `${EV}/QC-48-abort.png` });
  await p.unroute('**/api/tasks/*');
  await inp.focus(); await blurByClick(p); await settle(p);
  o.afterRetry = { alertCount: await p.locator('[role=alert]').count(), time: await row(p, 'Net').locator('time').textContent(), input: await inp.inputValue() };
  o.net = net;
  const okResp = net.some((x) => x.resp === 200 && x.m === 'PATCH');
  const ok = !!o.duringAbort.alert && o.duringAbort.time === '2026-12-01' && o.duringAbort.input === '2027-01-15' && okResp && o.afterRetry.alertCount === 0 && o.afterRetry.time === '2027-01-15';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/QC-48.png` }); await ctx.close();
});

await run('QC-49', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-49');
  await p.route('**/api/tasks', (r) => (r.request().method() === 'GET' ? r.abort() : r.continue()));
  await p.goto(BASE); await p.waitForTimeout(800);
  o.alert = await p.locator('[role=alert]').textContent().catch(() => null);
  await p.getByRole('button', { name: 'Просроченные' }).click(); o.overdueText = await p.locator('p:not([role=alert])').allTextContents();
  await p.screenshot({ path: `${EV}/QC-49.png` });
  await p.getByRole('button', { name: 'Все' }).click(); o.allText = await p.locator('p:not([role=alert])').allTextContents();
  o.consoleErrors = consoleLog.filter((m) => m.tag === 'QC-49' && (m.type === 'error' || m.type === 'pageerror'));
  o.net = net;
  const ok = !!o.alert && o.overdueText.includes('Нет просроченных задач') && o.allText.includes('No tasks yet.') && !o.consoleErrors.some((m) => m.type === 'pageerror');
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-59', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Shared' });
  const ctx = await newCtx(); const A = await ctx.newPage(); const B = await ctx.newPage(); track(A, 'QC-59A'); track(B, 'QC-59B');
  await A.goto(BASE); await settle(A); await B.goto(BASE); await settle(B);
  await B.getByLabel('Due date for Shared').fill(D_TOMORROW); await B.locator('h1').click(); await settle(B);
  await A.bringToFront(); await row(A, 'Shared').locator('input[type=checkbox]').click(); await settle(A);
  o.A = { time: await row(A, 'Shared').locator('time').textContent().catch(() => null), input: await A.getByLabel('Due date for Shared').inputValue() };
  o.get = JSON.parse(execSync(`curl -s ${API}/api/tasks`).toString());
  await A.screenshot({ path: `${EV}/QC-59.png` });
  const ok = o.A.time === D_TOMORROW && o.A.input === D_TOMORROW && o.get[0].dueDate === D_TOMORROW && o.get[0].done === true;
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-82b', async (o) => {
  // (b) part only: change the value without leaving the field, then F5 — draft must not be saved
  await reset(); await api('POST', '/api/tasks', { title: 'NoBlur', dueDate: '2026-12-01' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-82b'); await p.goto(BASE); await settle(p);
  const inp = p.getByLabel('Due date for NoBlur'); await inp.click(); await p.keyboard.press('ArrowUp'); // day/month segment +1 while focused
  o.draft = await inp.inputValue(); await p.reload(); await settle(p);
  o.afterF5 = await row(p, 'NoBlur').locator('time').textContent(); o.patches = net.filter((x) => x.m === 'PATCH').length;
  o.status = o.draft !== '2026-12-01' && o.afterF5 === '2026-12-01' && o.patches === 0 ? 'PASS' : 'FAIL'; await ctx.close();
});

await run('QC-83', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Seg', dueDate: '2026-12-01' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-83'); await p.goto(BASE); await settle(p);
  const inp = p.getByLabel('Due date for Seg'); await inp.click(); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); // year segment
  await p.keyboard.press('Backspace'); o.valueAfterBackspace = await inp.inputValue();
  await blurByClick(p); await settle(p);
  o.patches = net.filter((x) => x.m === 'PATCH' && 'body' in x).map((x) => x.body);
  o.timeCount = await row(p, 'Seg').locator('time').count();
  o.status = JSON.stringify(o.patches) === '["{\\"dueDate\\":null}"]' && o.timeCount === 0 ? 'PASS' : 'FAIL';
  o.note = 'наблюдение: неполная дата = срок убран'; await ctx.close();
});

await run('QC-80', async (o) => {
  o.errorsAndWarnings = consoleLog.filter((m) => ['error', 'warning', 'pageerror'].includes(m.type) && m.text !== 'qa-probe');
  const allowed = (m) => /favicon\.ico$/.test(m.url || '') || /Failed to load resource|net::ERR_FAILED|status of 40[04]/.test(m.text) && ['QC-46', 'QC-47', 'QC-48', 'QC-49'].includes(m.tag);
  o.unexpected = o.errorsAndWarnings.filter((m) => !allowed(m));
  o.total = consoleLog.length;
  o.status = o.unexpected.length === 0 ? 'PASS' : 'FAIL';
});

await browser.close();
writeFileSync(`${EV}/chrome-run-summary.json`, JSON.stringify(results.map((r) => ({ id: r.id, status: r.status, error: r.error })), null, 2));
writeFileSync(`${EV}/chrome-console.json`, JSON.stringify(consoleLog, null, 2));
