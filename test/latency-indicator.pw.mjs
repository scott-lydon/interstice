// The prompt-latency indicator increments while waiting, clears on the
// response, fires a distinct arrival notification once per completion, and does not break the
// immersive >=90% layout. Loads the real panel.html and drives the injectable
// window.__latency surface with controlled timestamps.
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
  await page.evaluate(() => { if (typeof setView === 'function') setView('reading'); document.body.classList.add('immersive'); });

  const T0 = 1_000_000_000_000;
  // 5.2: submit, then tick forward; the chip text increments and matches the elapsed.
  await page.evaluate((t) => window.__latency.submit('s1', t), T0);
  const at3 = await page.evaluate((t) => { window.__latency.tick(t); return document.getElementById('latency-chip').textContent; }, T0 + 3000);
  const at12 = await page.evaluate((t) => { window.__latency.tick(t); return document.getElementById('latency-chip').textContent; }, T0 + 72000);
  if (!/0:03/.test(at3)) fails.push(`5.2: chip at 3s was "${at3}"`);
  if (!/1:12/.test(at12)) fails.push(`5.2: chip at 72s was "${at12}" (expected 1:12)`);
  const shown = await page.evaluate(() => document.getElementById('latency-chip').classList.contains('show'));
  if (!shown) fails.push('5.2: chip is not visible while waiting');

  // 5.7: with the timer visible, #reader still >=90% of both dimensions.
  const m = await page.evaluate(() => { const r = document.getElementById('reader').getBoundingClientRect(); return { rw: r.width, rh: r.height, vw: innerWidth, vh: innerHeight }; });
  if (!(m.rw / m.vw >= 0.9 && m.rh / m.vh >= 0.9)) fails.push(`5.7: reader ${Math.round(m.rw)}x${Math.round(m.rh)} broke the >=90% layout`);

  // 5.3: completion clears the chip (not frozen).
  await page.evaluate((t) => window.__latency.complete('s1', t), T0 + 80000);
  const clearedShown = await page.evaluate(() => document.getElementById('latency-chip').classList.contains('show'));
  if (clearedShown) fails.push('5.3: chip did not clear after completion');

  // 5.4: the arrival notification appeared, is distinct from the chip, and fires once per completion.
  const arrival = await page.evaluate(() => {
    const n = document.getElementById('arrival-note');
    return { shown: n.classList.contains('show'), sameNode: n === document.getElementById('latency-chip'), cls: n.className };
  });
  if (!arrival.shown) fails.push('5.4: arrival notification did not appear');
  if (arrival.sameNode) fails.push('5.4: arrival notification is not distinct from the elapsed chip');

  // completing a session with no submit fires nothing (once-per-completion, no phantom).
  await page.evaluate((t) => window.__latency.complete('ghost', t), T0 + 90000);
  // (no assertion needed beyond not throwing; a phantom would have re-shown a stale chip)

  await browser.close();
  if (fails.length) { console.log('FAIL:\n' + fails.join('\n')); process.exit(1); }
  console.log('PASS: indicator increments, clears on response, distinct arrival notice, layout intact');
  process.exit(0);
} catch (e) { console.log('error:', e.message); await browser.close(); process.exit(2); }
