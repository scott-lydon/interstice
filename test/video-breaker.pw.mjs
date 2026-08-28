// The video breaker, against a real browser playing a real video file.
//
// Everything else about this breaker is covered by unit tests with an injected probe, and all of
// them passed while the breaker could not detect a single playing video in a real browser. The
// reason was one line: `probeVideo` evaluated its play-state expression with `t.sessionId`, and
// `Target.getTargets` does not return a sessionId. The evaluate therefore went to the browser
// session, where there is no page and no `Runtime` domain, Chrome answered "'Runtime.evaluate'
// wasn't found", and the catch turned that into `playing = false` on every tab forever.
//
// A stub probe cannot catch that, because the stub is the thing being bypassed. So this spec uses
// the real transport: a real Chromium started with a real debugging port, a real HTTP origin, and
// a real decodable video file, played until currentTime actually advances.
//
// Run: node test/video-breaker.pw.mjs   (exit 0 = pass)

import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '@playwright/test';

import { probeVideo } from '../lib/video/probe.js';
import { connect } from '../lib/cdp.js';
import { decideVideo, createVideoBreaker } from '../lib/focus/breakers/video.js';

const { chromium } = pkg;
const run = promisify(execFile);
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// A real, decodable video rather than a data: URI: the probe asks for `readyState > 2`, which
// only a track the browser has actually decoded satisfies.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-video-'));
const mp4Path = path.join(dir, 'demo.mp4');
try {
  await run('/opt/homebrew/bin/ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15',
    '-t', '6', '-pix_fmt', 'yuv420p', mp4Path], { timeout: 60000 });
} catch {
  console.log('SKIP: ffmpeg is not available to build a real video file');
  process.exit(0);
}

const mp4 = fs.readFileSync(mp4Path);
const srv = http.createServer((req, res) => {
  if (req.url.endsWith('.mp4')) { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(mp4); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<title>lesson</title><video id=v autoplay muted loop playsinline src="/demo.mp4"></video>');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${srv.address().port}/`;

const PORT = 9336;
const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(
    () => { const v = document.getElementById('v'); return v && !v.paused && v.currentTime > 0.2; },
    null, { timeout: 20000 });

  const truth = await page.evaluate(() => {
    const v = document.getElementById('v');
    return { paused: v.paused, ready: v.readyState, t: v.currentTime };
  });
  check(!truth.paused && truth.ready > 2 && truth.t > 0, `the page is not actually playing: ${JSON.stringify(truth)}`);

  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browsers = [{ name: 'chromium', wsUrl: ver.webSocketDebuggerUrl }];

  const records = await probeVideo({ browsers, connect });
  const ours = records.find((r) => r.url.startsWith(origin));
  check(Boolean(ours), 'the probe did not report the playing tab at all');
  // The assertion the old code could never satisfy.
  check(ours?.playing === true,
    `the probe reported playing=${ours?.playing} for a video the page says is playing`);
  check(ours?.host === 'localhost', `host read back as ${JSON.stringify(ours?.host)}`);

  check(decideVideo(records, { whitelist: ['localhost'] }) === null,
    'a whitelisted host must not break the block');
  const hit = decideVideo(records, { whitelist: ['udemy.com', '*.udemy.com'] });
  check(hit?.host === 'localhost', 'a non-whitelisted host must break the block');

  // The real breaker, with its real debounce: nothing before the window, a forfeit after it.
  const breaker = createVideoBreaker({
    whitelist: ['udemy.com'],
    breakAfterMs: 1000,
    probe: () => probeVideo({ browsers, connect }),
  });
  const t0 = new Date().toISOString();
  check((await breaker.probe(t0)) === null, 'a first sighting must be inside the debounce window');
  const t1 = new Date(Date.parse(t0) + 1500).toISOString();
  const forfeit = await breaker.probe(t1);
  check(forfeit?.cause === 'video', 'continuous non-whitelisted playback must forfeit the block');
  check(forfeit?.detail?.host === 'localhost', 'the forfeit must name the source');
} finally {
  await browser.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.error('FAIL:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('PASS: a real browser playing a real video is detected, whitelisted, and forfeits after the debounce');
