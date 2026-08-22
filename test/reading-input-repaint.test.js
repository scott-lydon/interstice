// POST /api/reading/input used to sleep a flat 350ms after a click and 250ms after a
// key before forcing a capture, with nothing anywhere saying why the two differed or where either
// number came from. They were the same guess at how long Amazon's reader takes to repaint.
//
// The reader already carries the answer: `capture` bumps `seq` only when the JPEG bytes differ, so
// the route now waits for that and returns the instant it moves. These tests pin both ends of it,
// because the failure mode of a wait like this is that it silently stops waiting.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../lib/server.js';
import { createReadingSurface } from '../lib/reading.js';
import { defaults } from '../lib/config.js';
import { readOrCreateToken } from '../lib/auth.js';
import { LOG_DIR } from '../lib/paths.js';

// A port per test: a keep-alive socket outlives the server it was opened to, and the next fetch
// on the same port is answered with ECONNRESET by a server that has already closed.
let nextPort = 7540;

/** A reader that repaints after `repaintAfter` captures, or never when that is Infinity. */
function fakeReader({ repaintAfter }) {
  let seq = 0;
  let captures = 0;
  return {
    running: true,
    get seq() {
      return seq;
    },
    get captures() {
      return captures;
    },
    async click() {
      return { ok: true, kind: 'click' };
    },
    async key() {
      return { ok: true, kind: 'key' };
    },
    async capture() {
      captures += 1;
      if (captures >= repaintAfter) seq = 1;
      return { seq };
    },
  };
}

async function withServer(reader, fn) {
  const PORT = nextPort;
  nextPort += 1;
  const config = { ...defaults(), port: PORT };
  const daemon = {
    reader,
    reading: createReadingSurface({ reader }),
    health: () => ({ ok: true }),
    panel: { state: () => ({}), ping() {} },
    focus: { status: () => ({}) },
    latency: { active: () => [] },
    engine: { status: { state: 'idle' } },
    stars: { starsForDay: () => [], starsForMonth: () => [] },
  };
  const token = readOrCreateToken(LOG_DIR);
  const srv = await createServer({ daemon, config });
  try {
    return await fn(async (body) => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/reading/input`, {
        method: 'POST',
        headers: { 'x-interstice-token': token },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await srv.close();
  }
}

test('an input returns as soon as the page repaints, not after a fixed sleep', async () => {
  const reader = fakeReader({ repaintAfter: 2 });
  const started = Date.now();
  const res = await withServer(reader, (post) => post({ kind: 'click', x: 10, y: 20 }));
  const elapsed = Date.now() - started;

  assert.equal(res.status, 200);
  assert.equal(res.body.repainted, true, 'the page changed, and the route says so');
  assert.equal(res.body.seq, 1, 'the frame served is the one taken after the click landed');
  assert.ok(elapsed < 600, `returned in ${elapsed}ms, well inside the 600ms ceiling`);
  assert.ok(reader.captures >= 2, 'it kept looking until the picture changed');
});

test('an input that changes nothing gives up at the ceiling and says it changed nothing', async () => {
  const reader = fakeReader({ repaintAfter: Infinity });
  const started = Date.now();
  const res = await withServer(reader, (post) => post({ kind: 'key', key: 'Escape' }));
  const elapsed = Date.now() - started;

  assert.equal(res.status, 200);
  assert.equal(res.body.repainted, false, 'a click on dead space is reported as one, not as success');
  assert.ok(res.body.waitedMs >= 600, `waited ${res.body.waitedMs}ms, which is the stated ceiling`);
  assert.ok(elapsed < 5000, 'and it does give up rather than waiting for the page forever');
});
