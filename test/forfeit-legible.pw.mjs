// A forfeited block is legible, not silent. The panel surfaces both the cause and the
// wall-clock time of the forfeit. Drives window.__focus.forfeit with a blockForfeited record.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const PANEL = pathToFileURL(path.resolve('web/panel.html')).href;
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
  await page.evaluate(() => { if (typeof setView === 'function') setView('reading'); });
  // a real blockForfeited record from lib/focus/blocks.js
  const rec = { type: 'blockForfeited', cause: 'video', at: '2026-08-19T14:07:00-07:00', elapsedMs: 1234000 };
  const shown = await page.evaluate((r) => {
    window.__focus.forfeit(r);
    const el = document.getElementById('forfeit-note');
    return { visible: el.classList.contains('show'), text: el.textContent, causeAttr: el.querySelector('.fn-cause')?.dataset.cause, when: el.querySelector('.fn-when')?.textContent };
  }, rec);
  if (!shown.visible) fails.push('forfeit banner not visible');
  if (shown.causeAttr !== 'video') fails.push(`cause not surfaced (got ${shown.causeAttr})`);
  if (shown.when !== '14:07') fails.push(`wall-clock time not surfaced (got "${shown.when}")`);
  if (!/forfeited/i.test(shown.text)) fails.push('banner does not name the forfeit');
  await browser.close();
  if (fails.length) { console.log('FAIL:\n' + fails.join('\n')); process.exit(1); }
  console.log('PASS: forfeit surfaces cause ("video") and wall-clock time (14:07), not silent');
  process.exit(0);
} catch (e) { console.log('error:', e.message); await browser.close(); process.exit(2); }
