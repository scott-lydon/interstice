// 2C.1: measure that #reader occupies >=90% of both usable panel dimensions while the reading view
// is active and immersive. Loads the real panel.html in a real browser and measures the rendered
// bounding boxes. Run: node test/immersive-layout.pw.mjs (exit 0 = pass).
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PANEL = pathToFileURL(path.resolve('web/panel.html')).href;
const W = 640, H = 900, MIN = 0.90;

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', () => {}); // panel fetches fail under file://; layout still renders
  await page.goto(PANEL);
  // Force the immersive reading state directly, independent of setView's scope.
  await page.evaluate(() => {
    if (typeof setView === 'function') setView('reading');
    else { for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === 'view-reading'); document.body.classList.add('immersive'); }
  });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const r = document.getElementById('reader').getBoundingClientRect();
    return { rw: r.width, rh: r.height, vw: window.innerWidth, vh: window.innerHeight };
  });
  const wFrac = m.rw / m.vw, hFrac = m.rh / m.vh;
  console.log(`#reader = ${Math.round(m.rw)}x${Math.round(m.rh)} of ${m.vw}x${m.vh}  (width ${(wFrac*100).toFixed(1)}%, height ${(hFrac*100).toFixed(1)}%)`);
  if (wFrac >= MIN && hFrac >= MIN) {
    console.log('2C.1 PASS: the page occupies >=90% of both dimensions');
    await browser.close();
    process.exit(0);
  }
  console.log('2C.1 FAIL');
  await browser.close();
  process.exit(1);
} catch (e) {
  console.log('error:', e.message);
  await browser.close();
  process.exit(2);
}
