import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoBreaker, decideVideo } from '../lib/focus/breakers/video.js';

const WL = ['udemy.com', '*.udemy.com'];
const rec = (url, playing, extra = {}) => ({ browser: 'Chrome', url, host: new URL(url).hostname, playing, ...extra });

test('a whitelisted host emits no break; a non-whitelisted one emits exactly one', async () => {
  const yt = createVideoBreaker({ whitelist: WL, breakAfterMs: 0, probe: async () => [rec('https://youtube.com/x', true)] });
  assert.ok(await yt.probe('2026-08-19T09:00:00-07:00'), 'youtube playing breaks (debounce 0)');

  const ud = createVideoBreaker({ whitelist: WL, breakAfterMs: 0, probe: async () => [rec('https://www.udemy.com/c', true)] });
  assert.equal(await ud.probe('2026-08-19T09:00:00-07:00'), null, 'udemy playing does not break');
});

test('the reader profile never emits a video break', () => {
  const hit = decideVideo([rec('https://read.amazon.com/x', true, { readerProfile: true })], { whitelist: WL });
  assert.equal(hit, null);
});

test('playback shorter than the threshold does not break; longer does (4.5 debounce)', async () => {
  let playing = true;
  const b = createVideoBreaker({ whitelist: WL, breakAfterMs: 4000, probe: async () => (playing ? [rec('https://youtube.com/x', true)] : []) });
  const t = (ms) => new Date(Date.parse('2026-08-19T09:00:00-07:00') + ms).toISOString();
  assert.equal(await b.probe(t(0)), null, 'first sighting is debounced');
  assert.equal(await b.probe(t(3999)), null, 'still under the threshold');
  const out = await b.probe(t(4000));
  assert.ok(out, 'at the threshold, it breaks');
  assert.equal(out.cause, 'video');
  assert.equal(out.detail.host, 'youtube.com');
});

test('a one-frame autoplay flicker resets and costs nothing', async () => {
  let frames = [true, false, true];
  let i = 0;
  const b = createVideoBreaker({ whitelist: WL, breakAfterMs: 4000, probe: async () => (frames[i++] ? [rec('https://youtube.com/x', true)] : []) });
  const t = (ms) => new Date(Date.parse('2026-08-19T09:00:00-07:00') + ms).toISOString();
  assert.equal(await b.probe(t(0)), null);       // playing, debounce starts
  assert.equal(await b.probe(t(5000)), null);    // stopped: timer resets despite time passing
  assert.equal(await b.probe(t(6000)), null);    // playing again but only just started
});
