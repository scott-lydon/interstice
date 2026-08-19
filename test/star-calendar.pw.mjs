// 3.8: star calendar behind the Phase 2 menu; day and month views; each star reveals the
// wall-clock start and end of the block that earned it. Opens the menu, opens the calendar,
// asserts a seeded star renders on the correct day cell, activates it, and checks the revealed
// times match the seeded values exactly.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const PANEL = pathToFileURL(path.resolve('web/panel.html')).href;
const browser = await chromium.launch({ channel: 'chrome' });
const fails = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
  page.on('pageerror', () => {});
  await page.goto(PANEL);
  await page.evaluate(() => { if (typeof setView === 'function') setView('reading'); });

  // open the menu, then the calendar (behind the Phase 2 menu)
  await page.click('#reader-menu');
  const menuOpen = await page.evaluate(() => document.getElementById('reader-menu-overlay').classList.contains('open'));
  if (!menuOpen) fails.push('3.8: reader menu did not open');
  await page.click('#open-star-cal');
  const calOpen = await page.evaluate(() => document.getElementById('star-cal-overlay').classList.contains('open'));
  if (!calOpen) fails.push('3.8: star calendar did not open from the menu');

  // seed one real star into the month view and assert it renders on the correct day cell
  const seed = { id: 'seed1', startedAt: '2026-08-19T09:12:00-07:00', endedAt: '2026-08-19T09:37:00-07:00', day: '2026-08-19' };
  const cellHasStar = await page.evaluate((st) => {
    window.__stars.render('month', '2026-08', [st]);
    const cell = document.querySelector('.cal-cell[data-day="2026-08-19"]');
    return !!cell && !!cell.querySelector('.cal-star');
  }, seed);
  if (!cellHasStar) fails.push('3.8: seeded star did not render on the 2026-08-19 cell');

  // activate the star, assert revealed start and end match the seeded values exactly
  const reveal = await page.evaluate(() => {
    document.querySelector('.cal-cell[data-day="2026-08-19"] .cal-star').click();
    const r = document.getElementById('cal-reveal');
    return { hidden: r.hidden, text: r.textContent };
  });
  if (reveal.hidden) fails.push('3.8: activating the star revealed nothing');
  if (!/09:12/.test(reveal.text)) fails.push(`3.8: revealed start != seeded 09:12 (got "${reveal.text}")`);
  if (!/09:37/.test(reveal.text)) fails.push(`3.8: revealed end != seeded 09:37 (got "${reveal.text}")`);

  // month/day toggle works
  const dayView = await page.evaluate(() => { document.getElementById('cal-view-toggle').click(); return document.getElementById('cal-title').textContent; });
  if (!/Stars on/.test(dayView)) fails.push(`3.8: day view toggle failed (title "${dayView}")`);

  await browser.close();
  if (fails.length) { console.log('FAIL:\n' + fails.join('\n')); process.exit(1); }
  console.log('3.8 PASS: calendar opens behind the menu, star renders on the right day, reveal shows 09:12 and 09:37 exactly');
  process.exit(0);
} catch (e) { console.log('error:', e.message); await browser.close(); process.exit(2); }
