// lib/server.js dispatches thirty-odd /api routes and three static HTML pages out of one
// request handler, which is the shape where a catch-all quietly starts answering API calls with a
// page. The route order is right (the exact-match table is consulted first, the three HTML paths
// are equality checks rather than a wildcard, and everything else falls through to a JSON 404),
// but nothing held it there: no test in this tree ever instantiated createServer, and the only
// content-type assertion in test/ was against a stub server that set the header on itself.
//
// So this stands up the real server on a port of its own and reads the header off real responses.
// A regression that made the fallthrough serve dashboard.html, or that dropped the header from
// json(), now fails here instead of on somebody's dashboard.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../lib/server.js';
import { defaults } from '../lib/config.js';
import { readOrCreateToken } from '../lib/auth.js';
import { LOG_DIR } from '../lib/paths.js';

// A port of its own, so this never collides with a daemon the operator is running.
const PORT = 7523;

const daemon = {
  health: () => ({ ok: true, pid: process.pid, counters: { gaps: 0 } }),
  panel: { state: () => ({ rung: null, seq: 0, detail: null }), ping() {} },
  focus: { status: () => ({ phase: 'idle', elapsedMs: 0 }) },
  latency: { active: () => [] },
  engine: { status: { state: 'idle' } },
  stars: { starsForDay: () => [], starsForMonth: () => [] },
};

const config = {
  ...defaults(),
  port: PORT,
  // A closed port with a short timeout, so /api/cards takes its error branch immediately instead
  // of depending on whether Anki happens to be running on the machine under test. Both branches
  // answer through the same json() helper, which is the thing being pinned.
  anki: { ...defaults().anki, url: 'http://127.0.0.1:1/', timeoutMs: 50, queueTimeoutMs: 50 },
};

/**
 * Every JSON route reachable without writing to a log or driving the machine.
 *
 * /api/companions and the POST rungs are deliberately absent: the companion snapshot takes two
 * real screen captures a second apart, and the POST routes append to the real queued-prompts log
 * or open windows. POST /api/queued stands in for the write side, sent empty so it takes its 400
 * branch and leaves nothing behind.
 */
const JSON_GETS = [
  '/api/health',
  '/api/status',
  '/api/config',
  '/api/gaps',
  '/api/stats',
  '/api/events',
  '/api/queued',
  '/api/panel',
  '/api/focus',
  '/api/cards',
  '/api/stars/day?day=2026-08-19',
  '/api/stars/month?month=2026-08',
];

const HTML_GETS = ['/', '/index.html', '/panel', '/debug'];

test('every JSON endpoint answers as JSON, and the fallthrough never serves a page', async (t) => {
  const token = readOrCreateToken(LOG_DIR);
  const srv = await createServer({ daemon, config });
  t.after(() => srv.close());

  const call = (pathname, init = {}) =>
    fetch(`http://127.0.0.1:${PORT}${pathname}`, {
      ...init,
      headers: { 'x-interstice-token': token, ...(init.headers ?? {}) },
    });

  for (const pathname of JSON_GETS) {
    const res = await call(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/, pathname);
    await res.json(); // parses, so the header is not merely a label on something else
  }

  // The write side, refused for being empty rather than appended.
  const posted = await call('/api/queued', { method: 'POST', body: JSON.stringify({ text: '' }) });
  assert.equal(posted.status, 400);
  assert.match(posted.headers.get('content-type') ?? '', /^application\/json/);

  // The handler's own error shape stays JSON too.
  const badDate = await call('/api/stars/day?day=not-a-date');
  assert.equal(badDate.status, 400);
  assert.match(badDate.headers.get('content-type') ?? '', /^application\/json/);

  // The fallthrough. This is the one the rule is really about: an unmatched path under a
  // catch-all page route comes back as HTML with a 200, and a client parsing it sees a syntax
  // error rather than a 404.
  for (const pathname of ['/nope', '/api/nope', '/api/health/extra']) {
    const res = await call(pathname);
    assert.equal(res.status, 404, pathname);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/, pathname);
    assert.equal((await res.json()).error, 'not found', pathname);
  }

  // Refusals are generated before dispatch, and they are JSON as well.
  const refused = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  assert.equal(refused.status, 401);
  assert.match(refused.headers.get('content-type') ?? '', /^application\/json/);

  // And the three pages that are genuinely pages.
  for (const pathname of HTML_GETS) {
    const res = await call(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html/, pathname);
    assert.match(await res.text(), /<html|<!DOCTYPE/i, pathname);
  }
});
