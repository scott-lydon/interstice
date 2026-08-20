// 2C.2/2C.3/2C.4: the single menu houses every displaced control (2C.2); page-turn works via arrow
// keys with the menu closed and open (2C.3); the menu is accessible: Escape closes it and focus
// returns to the trigger, which has an accessible name (2C.4). Loads the real panel.html.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PANEL = pathToFileURL(path.resolve('web/panel.html')).href;
const ENUMERATED = ['rungs', 'book-title', 'book-why', 'book-bar', 'reader-pager', 'page-prev',
  'page-next', 'reader-mode', 'reader-page', 'book-actions', 'reader-note', 'status', 'advance'];

// Browser choice: Playwright's bundled Chromium by default, because it is the engine the
// repo installs with `@playwright/test` and is therefore always present. `channel: 'chrome'`
// needs a separately-installed Chrome, and where that is missing the launch hangs until the
// runner's timeout and reports a product failure for an environment reason. Set
// INTERSTICE_PW_CHANNEL=chrome to test against real Chrome instead.
const LAUNCH = process.env.INTERSTICE_PW_CHANNEL ? { channel: process.env.INTERSTICE_PW_CHANNEL } : {};
const browser = await chromium.launch(LAUNCH);
const fails = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
  page.on('pageerror', () => {});
  await page.goto(PANEL);
  await page.evaluate(() => {
    if (typeof setView === 'function') setView('reading');
    else { for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === 'view-reading'); document.body.classList.add('immersive'); }
    // spy on fetch so page-turns are observable and non-erroring under file://
    window.__turns = [];
    const real = window.fetch;
    window.fetch = (url, opts) => {
      try { if (String(url).includes('/api/reading/input')) window.__turns.push(JSON.parse(opts.body)); } catch {}
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
  });

  // 2C.2: exactly one menu trigger
  const triggers = await page.locator('.reader-menu').count();
  if (triggers !== 1) fails.push(`2C.2: expected 1 menu trigger, found ${triggers}`);

  // open the menu and assert every enumerated element is now inside the overlay
  await page.click('#reader-menu');
  for (const id of ENUMERATED) {
    const inside = await page.evaluate((eid) => {
      const el = document.getElementById(eid);
      const ov = document.getElementById('reader-menu-overlay');
      return !!el && ov.contains(el);
    }, id);
    if (!inside) fails.push(`2C.2: #${id} is not housed in the menu overlay`);
  }

  // 2C.4: Escape closes the menu and returns focus to the trigger, which has an accessible name
  const label = await page.getAttribute('#reader-menu', 'aria-label');
  if (!label) fails.push('2C.4: the menu trigger has no accessible name');
  await page.keyboard.press('Escape');
  const open = await page.evaluate(() => document.getElementById('reader-menu-overlay').classList.contains('open'));
  if (open) fails.push('2C.4: Escape did not close the menu');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'reader-menu') fails.push(`2C.4: focus did not return to the trigger (was #${focused})`);

  // after close, the elements are restored outside the overlay
  const restored = await page.evaluate(() => {
    const ov = document.getElementById('reader-menu-overlay');
    return !ov.contains(document.getElementById('book-title'));
  });
  if (!restored) fails.push('2C.2: elements were not restored outside the menu after close');

  // 2C.3: arrow keys turn pages, menu closed then open
  await page.evaluate(() => { window.__turns = []; });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  let turns = await page.evaluate(() => window.__turns.map((t) => t.direction));
  if (!(turns.includes('next') && turns.includes('prev'))) fails.push(`2C.3: arrows did not turn pages menu-closed (${turns})`);
  await page.click('#reader-menu'); // open
  await page.evaluate(() => { window.__turns = []; });
  await page.keyboard.press('ArrowRight');
  turns = await page.evaluate(() => window.__turns.map((t) => t.direction));
  if (!turns.includes('next')) fails.push(`2C.3: arrows did not turn pages menu-open (${turns})`);

  await browser.close();
  if (fails.length) { console.log('FAIL:\n' + fails.join('\n')); process.exit(1); }
  console.log('2C.2 / 2C.3 / 2C.4 PASS: one menu houses every control, arrows turn pages both states, Escape closes and returns focus');
  process.exit(0);
} catch (e) {
  console.log('error:', e.message); await browser.close(); process.exit(2);
}
