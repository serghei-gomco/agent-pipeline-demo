import { createRequire } from 'module'; import { writeFileSync } from 'fs'; const require = createRequire(import.meta.url);
const { chromium } = require('~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
const b = await chromium.launch({ channel: 'chrome' }); const c = await b.newContext({ viewport: { width: 375, height: 800 } }); const p = await c.newPage();
await p.goto('http://localhost:5173'); await p.waitForLoadState('networkidle');
const r = await p.evaluate(() => {
  const m = () => ({ scrollW: document.documentElement.scrollWidth, formRight: Math.round(document.querySelector('form').getBoundingClientRect().right), addRight: Math.round(document.querySelector('button[type=submit]').getBoundingClientRect().right) });
  const out = { vw: document.documentElement.clientWidth, withDueField: m() };
  document.querySelector('#new-due').style.display = 'none'; document.querySelector('label[for=new-due]').style.display = 'none';
  out.withoutDueField_preTaskEquivalent = m(); return out;
});
r.tasksInList = await p.locator('li').count();
writeFileSync(process.argv[2], JSON.stringify(r, null, 2)); console.log(JSON.stringify(r));
await p.screenshot({ path: process.argv[3] });
await b.close();
