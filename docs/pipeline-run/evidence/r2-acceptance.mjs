// Acceptance r1, repeat 2 (HEAD 7cbc36a, F-7), Chrome via Playwright 1.66 channel=chrome. Writes evidence/r2-QC-n.txt|png.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');

const EV = './.tasks/T-20261112-1-due-dates-overdue/evidence';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001';
const D_TOMORROW = '2026-11-13';
const RED = 'rgb(198, 40, 40)';
const FORM_ERR = 'Enter a complete due date or clear the field.';
const only = process.argv[2] ? process.argv[2].split(',') : null;

const results = [];
const consoleLog = [];
const ev = (id, obj) => writeFileSync(`${EV}/r2-${id}.txt`, JSON.stringify(obj, null, 2) + '\n');

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
const reqs = (net, m) => net.filter((x) => x.m === m && 'body' in x);
const row = (page, title) => page.locator('li', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) });
const color = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
const blurByClick = (page) => page.locator('h1').click();
const settle = (page) => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(200));
const fieldState = (loc) => loc.evaluate((el) => ({ value: el.value, badInput: el.validity.badInput }));
const alerts = (page) => page.$$eval('[role=alert]', (a) => a.map((x) => x.textContent));

async function run(id, fn) {
  if (only && !only.includes(id)) return;
  const out = { id };
  try { await fn(out); } catch (e) { out.status = 'ERROR'; out.error = String(e.stack || e); }
  results.push(out); ev(id, out); console.log(id, out.status, out.note ?? '');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const newCtx = (opts = {}) => browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, ...opts });

await run('QC-80-control', async (o) => {
  const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'control');
  await p.goto(BASE); await p.evaluate(() => console.error('qa-probe')); await p.waitForTimeout(100);
  o.captured = consoleLog.some((m) => m.text === 'qa-probe'); o.browserVersion = browser.version();
  o.status = o.captured ? 'PASS' : 'FAIL'; await ctx.close();
});

// BUG-1: 375 px form + rows
await run('QC-69', async (o) => {
  await reset();
  const t120 = ('L'.repeat(60) + 'ДлинноеНазвание'.repeat(4)).slice(0, 120);
  const spaced = ('Оплатить счёт за аренду офиса и согласовать новый договор с арендодателем до конца месяца, иначе штраф и пени '.repeat(2)).slice(0, 120);
  const measure = () => {
    const vw = document.documentElement.clientWidth;
    const r = (el) => el?.getBoundingClientRect();
    const form = { addRight: r(document.querySelector('button[type=submit]')).right, dueRight: r(document.querySelector('#new-due')).right, titleRight: r(document.querySelector('#new-title')).right };
    const rows = [...document.querySelectorAll('li')].map((li) => {
      const time = r(li.querySelector('time')), inp = r(li.querySelector('input[type=date]')), btn = r(li.querySelector('button'));
      return { title: li.querySelector('.title').textContent.slice(0, 25), timeH: Math.round(time.height), timeText: li.querySelector('time').textContent,
        offscreen: inp.right > vw + 0.5 || btn.right > vw + 0.5, overlapTimeInput: time.right > inp.left + 0.5, timeOneLine: time.height < 30,
        aria: li.querySelector('input[type=date]').getAttribute('aria-label').slice(0, 30) };
    });
    return { vw, scrollW: document.documentElement.scrollWidth, hScroll: document.documentElement.scrollWidth > vw, form, formOffscreen: form.addRight > vw + 0.5 || form.dueRight > vw + 0.5, rows };
  };
  o.sets = {};
  for (const [name, titles] of [['empty', []], ['spaced', [spaced, 'Кириллица и эмодзи 🎉🚀 задача', 'Short']], ['unbroken', [t120, 'Short']]]) {
    await reset(); for (const t of titles) await api('POST', '/api/tasks', { title: t, dueDate: D_TOMORROW });
    o.sets[name] = {};
    for (const w of [1280, 375]) {
      const ctx = await newCtx({ viewport: { width: w, height: 800 } }); const p = await ctx.newPage(); track(p, 'QC-69'); await p.goto(BASE); await settle(p);
      o.sets[name][w] = await p.evaluate(measure);
      await p.screenshot({ path: `${EV}/r2-QC-69-${name}-${w}.png`, fullPage: true }); await ctx.close();
    }
  }
  const okSet = (s) => !s.hScroll && !s.formOffscreen && s.rows.every((r) => !r.offscreen && !r.overlapTimeInput && r.timeOneLine);
  o.verdictBySet = Object.fromEntries(Object.entries(o.sets).map(([k, v]) => [k, { 1280: okSet(v[1280]), 375: okSet(v[375]) }]));
  o.status = Object.values(o.verdictBySet).every((v) => v[1280] && v[375]) ? 'PASS' : 'FAIL';
});

// BUG-2: active mode visible
await run('QC-84', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); track(p, 'QC-84'); await p.goto(BASE); await settle(p);
  const sty = (name) => p.getByRole('button', { name }).evaluate((el) => { const s = getComputedStyle(el); return { pressed: el.getAttribute('aria-pressed'), bg: s.backgroundColor, color: s.color, border: s.border, fw: s.fontWeight }; });
  o.allActive = { all: await sty('Все'), overdue: await sty('Просроченные') };
  await p.locator('.filter').screenshot({ path: `${EV}/r2-QC-84-all-active.png` });
  await p.getByRole('button', { name: 'Просроченные' }).click(); await blurByClick(p);
  o.overdueActive = { all: await sty('Все'), overdue: await sty('Просроченные') };
  await p.locator('.filter').screenshot({ path: `${EV}/r2-QC-84-overdue-active.png` });
  await p.getByRole('button', { name: 'Все' }).click(); await blurByClick(p);
  o.backToAll = { all: await sty('Все'), overdue: await sty('Просроченные') };
  const same = (a, b) => a.bg === b.bg && a.color === b.color && a.border === b.border && a.fw === b.fw;
  o.checks = {
    allMode_activeDiffersFromInactive: !same(o.allActive.all, o.allActive.overdue),
    overdueMode_activeDiffersFromInactive: !same(o.overdueActive.overdue, o.overdueActive.all),
    activeLookFollowsMode: same(o.allActive.all, o.overdueActive.overdue) && same(o.allActive.overdue, o.overdueActive.all),
    backToAllRestores: same(o.backToAll.all, o.allActive.all) && same(o.backToAll.overdue, o.allActive.overdue),
  };
  o.status = Object.values(o.checks).every(Boolean) ? 'PASS' : 'FAIL'; await ctx.close();
});

// QC-83: half-typed date in a task row must not clear the due date
await run('QC-83', async (o) => {
  await reset(); const c = await api('POST', '/api/tasks', { title: 'Seg', dueDate: '2026-12-01' }); const id = c.body.id;
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-83'); await p.goto(BASE); await settle(p);
  const inp = () => p.getByLabel('Due date for Seg');
  await inp().click(); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); // year segment (дд.мм.гггг)
  await p.keyboard.press('Backspace'); o.afterBackspace = await fieldState(inp());
  await blurByClick(p); await settle(p);
  o.patchesAfterHalfTyped = reqs(net, 'PATCH').map((x) => x.body);
  o.timeAfterBlur = await row(p, 'Seg').locator('time').textContent().catch(() => null);
  o.apiAfterBlur = (await api('GET', '/api/tasks')).body.find((t) => t.id === id)?.dueDate;
  o.rowAlerts = await alerts(p);
  await p.screenshot({ path: `${EV}/r2-QC-83-half-typed.png` });
  await p.reload(); await settle(p);
  o.afterF5 = { time: await row(p, 'Seg').locator('time').textContent().catch(() => null), field: await fieldState(inp()) };
  // positive control (same tool, same session): clear all three segments by keyboard -> must send PATCH null
  await inp().click({ position: { x: 8, y: 8 } }); // day segment
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Backspace'); if (i < 2) await p.keyboard.press('ArrowRight'); }
  o.afterFullClear = await fieldState(inp());
  await blurByClick(p); await settle(p);
  o.patchesTotal = reqs(net, 'PATCH').map((x) => x.body);
  o.timeAfterFullClear = await row(p, 'Seg').locator('time').count();
  o.apiAfterFullClear = (await api('GET', '/api/tasks')).body.find((t) => t.id === id)?.dueDate;
  const ok = o.afterBackspace.badInput === true && o.patchesAfterHalfTyped.length === 0 && o.timeAfterBlur === '2026-12-01' && o.apiAfterBlur === '2026-12-01' && o.afterF5.time === '2026-12-01';
  const control = o.afterFullClear.badInput === false && JSON.stringify(o.patchesTotal) === '["{\\"dueDate\\":null}"]' && o.timeAfterFullClear === 0 && o.apiAfterFullClear === null;
  o.positiveControl = control;
  o.status = ok && control ? 'PASS' : ok ? 'INCONCLUSIVE' : 'FAIL'; await ctx.close();
});

// New case: create form with a half-typed date
await run('QC-87', async (o) => {
  await reset(); await api('POST', '/api/tasks', { title: 'Existing' });
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-87'); await p.goto(BASE); await settle(p);
  o.h0 = await p.textContent('h1');
  const due = p.locator('#new-due');
  // (a) half-typed: day+month only, click Add
  await p.fill('#new-title', 'Half');
  await due.click({ position: { x: 8, y: 8 } }); await due.pressSequentially('0101', { delay: 60 });
  o.a = { field: await fieldState(due) };
  await p.click('button[type=submit]'); await settle(p);
  o.a.posts = reqs(net, 'POST').length; o.a.alerts = await alerts(p); o.a.rowHalf = await row(p, 'Half').count();
  o.a.h1 = await p.textContent('h1'); o.a.fieldsAfter = { title: await p.inputValue('#new-title'), due: await fieldState(due) };
  await p.screenshot({ path: `${EV}/r2-QC-87-half-typed.png` });
  // (b) same state, submit with Enter from the title field
  await p.locator('#new-title').press('Enter'); await settle(p);
  o.b = { posts: reqs(net, 'POST').length, alerts: await alerts(p), title: await p.inputValue('#new-title') };
  // (c) clear the date completely by keyboard -> Add -> task without due date
  await due.click({ position: { x: 8, y: 8 } });
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Backspace'); if (i < 2) await p.keyboard.press('ArrowRight'); }
  o.c = { fieldBefore: await fieldState(due) };
  await p.click('button[type=submit]'); await settle(p);
  const posts = reqs(net, 'POST'); o.c.postBodies = posts.map((x) => x.body); o.c.resp = net.filter((x) => x.resp && x.m === 'POST').map((x) => x.resp);
  o.c.rowHalf = await row(p, 'Half').count(); o.c.timeInRow = await row(p, 'Half').locator('time').count(); o.c.alerts = await alerts(p);
  o.c.fieldsAfter = { title: await p.inputValue('#new-title'), due: await fieldState(due) };
  // (d) empty field from the start -> task without due date
  await p.fill('#new-title', 'NoDue'); o.d = { fieldBefore: await fieldState(due) };
  await p.click('button[type=submit]'); await settle(p);
  o.d.postBody = reqs(net, 'POST').at(-1)?.body; o.d.timeInRow = await row(p, 'NoDue').locator('time').count();
  // (e) positive control: complete the date after a half-typed one -> created with the date, error gone
  await p.fill('#new-title', 'Full'); await due.click({ position: { x: 8, y: 8 } }); await due.pressSequentially('0101', { delay: 60 });
  await p.click('button[type=submit]'); await settle(p); o.e = { alertAfterHalf: await alerts(p) };
  await due.pressSequentially('2027', { delay: 60 }); o.e.field = await fieldState(due);
  await p.click('button[type=submit]'); await settle(p);
  o.e.postBody = reqs(net, 'POST').at(-1)?.body; o.e.time = await row(p, 'Full').locator('time').textContent().catch(() => null); o.e.alertsAfter = await alerts(p);
  o.api = (await api('GET', '/api/tasks')).body.map((t) => ({ title: t.title, dueDate: t.dueDate }));
  await p.screenshot({ path: `${EV}/r2-QC-87-final.png` });
  const ok =
    o.a.field.badInput && o.a.posts === 0 && o.a.alerts.includes(FORM_ERR) && o.a.rowHalf === 0 && o.a.h1 === o.h0 && o.a.fieldsAfter.title === 'Half' && o.a.fieldsAfter.due.badInput &&
    o.b.posts === 0 && o.b.title === 'Half' &&
    o.c.fieldBefore.badInput === false && o.c.fieldBefore.value === '' && JSON.stringify(o.c.postBodies) === '["{\\"title\\":\\"Half\\",\\"dueDate\\":null}"]' && o.c.rowHalf === 1 && o.c.timeInRow === 0 && !o.c.alerts.includes(FORM_ERR) &&
    o.d.postBody === '{"title":"NoDue","dueDate":null}' && o.d.timeInRow === 0 &&
    o.e.alertAfterHalf.includes(FORM_ERR) && o.e.postBody === '{"title":"Full","dueDate":"2027-01-01"}' && o.e.time === '2027-01-01' && !o.e.alertsAfter.includes(FORM_ERR);
  o.status = ok ? 'PASS' : 'FAIL'; o.net = net; await ctx.close();
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
  await p.screenshot({ path: `${EV}/r2-${id}.png` });
  const ok = o.browser.tz === tz && o.red.title === RED && o.red.time === RED && o.not.title !== RED && o.not.time !== RED && JSON.stringify(o.overdueMode) === '["RedOne"]';
  o.status = ok ? 'PASS' : 'FAIL'; await ctx.close();
}
await run('QC-71', (o) => tzCase(o, 'QC-71', 'Europe/Chisinau', '2026-11-11T22:30:00Z', '2026-11-11', '2026-11-12'));
await run('QC-72', (o) => tzCase(o, 'QC-72', 'America/New_York', '2026-11-12T04:30:00Z', '2026-11-10', '2026-11-11'));

// AC-10 (QC-38): POST bodies
await run('QC-38', async (o) => {
  await reset(); const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-38');
  await p.goto(BASE); await settle(p);
  await p.fill('#new-title', 'WithDate'); await p.fill('#new-due', D_TOMORROW); await p.click('button[type=submit]'); await settle(p);
  o.fieldsAfterFirst = { title: await p.inputValue('#new-title'), due: await p.inputValue('#new-due') };
  await p.fill('#new-title', 'NoDate'); await p.click('button[type=submit]'); await settle(p);
  o.posts = reqs(net, 'POST').map((x) => x.body); o.resp = net.filter((x) => x.resp && x.m === 'POST').map((x) => x.resp);
  await p.reload(); await settle(p);
  o.afterF5 = { withDate: await row(p, 'WithDate').locator('time').textContent().catch(() => null), noDateTime: await row(p, 'NoDate').locator('time').count() };
  const ok = JSON.stringify(o.posts) === JSON.stringify(['{"title":"WithDate","dueDate":"2026-11-13"}', '{"title":"NoDate","dueDate":null}']) &&
    JSON.stringify(o.resp) === '[201,201]' && o.afterF5.withDate === D_TOMORROW && o.afterF5.noDateTime === 0 && o.fieldsAfterFirst.title === '' && o.fieldsAfterFirst.due === '';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/r2-QC-38.png` }); await ctx.close();
});

// AC-11 (QC-37): PATCH bodies
await run('QC-37', async (o) => {
  await reset();
  const c = await api('POST', '/api/tasks', { title: 'Edit me', dueDate: '2026-12-01' }); const id = c.body.id;
  const ctx = await newCtx(); const p = await ctx.newPage(); const net = track(p, 'QC-37');
  await p.goto(BASE); await settle(p);
  await p.getByLabel('Due date for Edit me').fill('2027-01-15'); await blurByClick(p); await settle(p);
  await p.reload(); await settle(p);
  o.afterFirstF5 = { time: await row(p, 'Edit me').locator('time').textContent().catch(() => null), input: await p.getByLabel('Due date for Edit me').inputValue() };
  await p.getByLabel('Due date for Edit me').fill(''); await blurByClick(p); await settle(p);
  await p.reload(); await settle(p);
  o.afterSecondF5 = { timeCount: await row(p, 'Edit me').locator('time').count(), input: await p.getByLabel('Due date for Edit me').inputValue() };
  o.patches = reqs(net, 'PATCH');
  o.resp = net.filter((x) => x.resp && x.m === 'PATCH').map((x) => x.resp);
  const ok = o.patches.length === 2 && o.patches.every((r) => r.url === `/api/tasks/${id}`) && o.patches[0].body === '{"dueDate":"2027-01-15"}' && o.patches[1].body === '{"dueDate":null}' &&
    o.afterFirstF5.time === '2027-01-15' && o.afterSecondF5.timeCount === 0 && o.afterSecondF5.input === '';
  o.status = ok ? 'PASS' : 'FAIL'; await p.screenshot({ path: `${EV}/r2-QC-37.png` }); await ctx.close();
});

// QC-88 (F-7): two tabs; due date changed in tab B; in tab A tick the checkbox -> field shows the new date;
// Tab through the field without typing sends no PATCH (old date is not sent back).
await run('QC-88', async (o) => {
  await reset(); const c = await api('POST', '/api/tasks', { title: 'Two tabs', dueDate: '2026-12-01' }); const id = c.body.id;
  const ctx = await newCtx(); const a = await ctx.newPage(); const netA = track(a, 'QC-88-A'); await a.goto(BASE); await settle(a);
  const b = await ctx.newPage(); const netB = track(b, 'QC-88-B'); await b.goto(BASE); await settle(b);
  const fA = () => a.getByLabel('Due date for Two tabs');
  const st = async () => ({ time: await row(a, 'Two tabs').locator('time').textContent().catch(() => null), field: await fA().inputValue(), checked: await row(a, 'Two tabs').locator('input[type=checkbox]').isChecked() });
  // B: change the date
  await b.bringToFront(); await b.getByLabel('Due date for Two tabs').fill('2027-02-02'); await blurByClick(b); await settle(b);
  o.patchesB = reqs(netB, 'PATCH').map((x) => x.body);
  o.apiAfterB = (await api('GET', '/api/tasks')).body.find((t) => t.id === id);
  // A: stale view
  await a.bringToFront(); o.aStale = await st();
  // (a) Tab through the stale field before any action: no PATCH expected
  await row(a, 'Two tabs').locator('input[type=checkbox]').focus();
  o.focusTrailStale = [];
  for (let i = 0; i < 8; i++) { await a.keyboard.press('Tab'); const f = await a.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName); o.focusTrailStale.push(f); if (i > 0 && f !== 'Due date for Two tabs') break; }
  await settle(a); o.patchesA_afterStaleTab = reqs(netA, 'PATCH').map((x) => x.body);
  // (b) tick the checkbox in A -> answer brings dueDate from B
  await row(a, 'Two tabs').locator('input[type=checkbox]').click(); await settle(a);
  o.aAfterTick = await st();
  // (c) Tab through the date field without typing
  await row(a, 'Two tabs').locator('input[type=checkbox]').focus();
  o.focusTrail = [];
  for (let i = 0; i < 8; i++) { await a.keyboard.press('Tab'); const f = await a.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName); o.focusTrail.push(f); if (i > 0 && f !== 'Due date for Two tabs') break; }
  await settle(a); o.patchesA_afterTabOnly = reqs(netA, 'PATCH').map((x) => x.body);
  await blurByClick(a); await settle(a);
  o.patchesA = reqs(netA, 'PATCH').map((x) => ({ url: x.url, body: x.body }));
  o.apiAfterTab = (await api('GET', '/api/tasks')).body.find((t) => t.id === id);
  o.aAfterTab = await st();
  await a.screenshot({ path: `${EV}/r2-QC-88.png` });
  // positive control (same tool, same tab): type a date into the field and leave it by Tab -> exactly one PATCH with it
  await fA().fill('2027-03-03'); o.focusTrailControl = [];
  for (let i = 0; i < 8; i++) { await a.keyboard.press('Tab'); const f = await a.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName); o.focusTrailControl.push(f); if (f !== 'Due date for Two tabs') break; }
  await settle(a);
  o.patchesA_control = reqs(netA, 'PATCH').map((x) => x.body);
  o.apiAfterControl = (await api('GET', '/api/tasks')).body.find((t) => t.id === id)?.dueDate;
  await a.reload(); await settle(a); o.aAfterF5 = await st();
  const okMain = JSON.stringify(o.patchesB) === '["{\\"dueDate\\":\\"2027-02-02\\"}"]' && o.aStale.field === '2026-12-01' &&
    o.patchesA_afterStaleTab.length === 0 && o.focusTrailStale.at(-1) !== 'Due date for Two tabs' && o.focusTrail.at(-1) !== 'Due date for Two tabs' &&
    JSON.stringify(o.patchesA_afterTabOnly) === '["{\\"done\\":true}"]' &&
    o.aAfterTick.time === '2027-02-02' && o.aAfterTick.field === '2027-02-02' && o.aAfterTick.checked === true &&
    o.focusTrail.includes('Due date for Two tabs') &&
    o.patchesA.length === 1 && o.patchesA[0].body === '{"done":true}' && o.patchesA[0].url === `/api/tasks/${id}` &&
    o.apiAfterTab.dueDate === '2027-02-02' && o.apiAfterTab.done === true && o.aAfterTab.field === '2027-02-02';
  const control = o.focusTrailControl.at(-1) !== 'Due date for Two tabs' && JSON.stringify(o.patchesA_control.slice(1)) === '["{\\"dueDate\\":\\"2027-03-03\\"}"]' && o.apiAfterControl === '2027-03-03' && o.aAfterF5.time === '2027-03-03';
  o.positiveControl = control; o.netA = netA; o.netB = netB;
  o.status = okMain && control ? 'PASS' : okMain ? 'INCONCLUSIVE' : 'FAIL'; await ctx.close();
});

await run('QC-80', async (o) => {
  o.errorsAndWarnings = consoleLog.filter((m) => ['error', 'warning', 'pageerror'].includes(m.type) && m.text !== 'qa-probe');
  o.unexpected = o.errorsAndWarnings.filter((m) => !/favicon\.ico$/.test(m.url || ''));
  o.total = consoleLog.length;
  o.status = o.unexpected.length === 0 ? 'PASS' : 'FAIL';
});

await browser.close();
writeFileSync(`${EV}/r2-run-summary.json`, JSON.stringify(results.map((r) => ({ id: r.id, status: r.status, error: r.error })), null, 2));
writeFileSync(`${EV}/r2-chrome-console.json`, JSON.stringify(consoleLog, null, 2));
