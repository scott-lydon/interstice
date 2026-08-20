// lib/server.js reached through the daemon into the Reader 33 times,
// including at three plain fields (`seq`, `running`, `signingIn`) of a 1747-line class, and the
// reader's own sequencing lived inside the route bodies. Understanding one HTTP route meant
// holding lib/server.js, lib/daemon.js and the whole of lib/reader.js in mind at once.
//
// lib/reading.js is now the only surface the HTTP layer is allowed to hold. These tests pin both
// halves of that: that the boundary is not quietly crossed again, and that every route on the far
// side of it still reaches the reader operation it is named for. Before this file, not one of
// these routes was exercised by any test at all, so a mistake in the migration would have shown up
// the next time somebody opened a book rather than here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createServer } from '../lib/server.js';
import { createReadingSurface } from '../lib/reading.js';
import { defaults } from '../lib/config.js';
import { readOrCreateToken } from '../lib/auth.js';
import { LOG_DIR, ROOT } from '../lib/paths.js';

// A port per test, not one for the file: a keep-alive socket from a previous test outlives the
// server it was opened to, and the next fetch on the same port is answered with ECONNRESET by a
// server that has already closed.
let nextPort = 7526;

test('the HTTP layer names no member of the Reader', () => {
  const server = fs.readFileSync(path.join(ROOT, 'lib', 'server.js'), 'utf8');
  assert.ok(
    !/daemon\.reader\b/.test(server),
    'lib/server.js reaches into the Reader again; it must go through daemon.reading (lib/reading.js)'
  );
  // And the daemon is where the two are joined, so the protocol has exactly one composer.
  const daemon = fs.readFileSync(path.join(ROOT, 'lib', 'daemon.js'), 'utf8');
  assert.match(daemon, /createReadingSurface/, 'lib/daemon.js is what builds the reading surface');
});

/**
 * A reader that records what was asked of it. Every method the surface names is here and nothing
 * else is, which is itself the assertion: a surface that reached for something new would throw.
 */
function recordingReader({ repaintAfter = 1 } = {}) {
  const calls = [];
  let seq = 0;
  let captures = 0;
  const note = (name, args) => calls.push([name, args]);
  return {
    calls,
    running: true,
    signingIn: false,
    get seq() {
      return seq;
    },
    signInStatus() {
      note('signInStatus');
      return { open: false };
    },
    async ensure(opts) {
      note('ensure', opts);
    },
    async state() {
      note('state');
      return { ready: true, signedOut: false };
    },
    async recoverIfPossible() {
      note('recoverIfPossible');
      return { carried: 0 };
    },
    async capture(opts) {
      note('capture', opts);
      captures += 1;
      if (captures >= repaintAfter) seq = 1;
      return { seq, jpeg: Buffer.from('jpeg-bytes') };
    },
    readAhead() {
      note('readAhead');
    },
    async text(opts) {
      note('text', opts);
      return { ok: true, text: 'a page of words' };
    },
    shelf() {
      note('shelf');
      return [{ pos: 1 }];
    },
    async turn(direction) {
      note('turn', direction);
      return { ok: true, direction };
    },
    async click(x, y) {
      note('click', [x, y]);
      return { ok: true };
    },
    async key(k, opts) {
      note('key', [k, opts]);
      return { ok: true };
    },
    async type(t) {
      note('type', t);
      return { ok: true };
    },
    async reauthenticate() {
      note('reauthenticate');
      return { signedIn: true, carried: 3 };
    },
    startSignIn(opts) {
      note('startSignIn', opts);
      return { started: true };
    },
    async startSafariSignIn(opts) {
      note('startSafariSignIn', opts);
      return { started: true, browser: 'Safari' };
    },
    async retryBook() {
      note('retryBook');
      return { ok: true };
    },
    async close() {
      note('close');
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
  const call = async (method, pathname, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
      method,
      headers: { 'x-interstice-token': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, body: type.startsWith('application/json') ? await res.json() : await res.arrayBuffer() };
  };
  try {
    return await fn(call, reader);
  } finally {
    await srv.close();
  }
}

/**
 * The routes that do not first read the Kindle store. POST /api/reading/view and POST
 * /api/reading/signin are deliberately absent: both open another application's container, which is
 * a real permission-gated read on the machine under test and not what this file is pinning.
 */
test('every reading route reaches the reader operation it is named for', async () => {
  await withServer(recordingReader(), async (call, reader) => {
    const frame = await call('GET', '/api/reading/frame');
    assert.equal(frame.status, 200);
    assert.match(frame.type, /^image\/jpeg/, 'the frame is still served as an image, not as JSON');

    const words = await call('GET', '/api/reading/text?fresh=1');
    assert.equal(words.status, 200);
    assert.equal(words.body.text, 'a page of words');
    assert.equal(words.body.seq, 1, 'the words carry the sequence of the frame they belong to');
    assert.deepEqual(words.body.shelf, [{ pos: 1 }], 'and the shelf beside them');
    assert.deepEqual(reader.calls.find((c) => c[0] === 'text')[1], { fresh: true }, '?fresh=1 reaches the reader');

    const turn = await call('POST', '/api/reading/input', { kind: 'turn', direction: 'forward' });
    assert.equal(turn.status, 200);
    assert.equal(turn.body.direction, 'forward');

    const typed = await call('POST', '/api/reading/input', { kind: 'text', text: 'hello' });
    assert.equal(typed.status, 200);
    assert.equal(reader.calls.find((c) => c[0] === 'type')[1], 'hello');

    const session = await call('POST', '/api/reading/session', {});
    assert.equal(session.status, 200);
    assert.equal(session.body.ok, true, 'signed in, not merely "cookies moved"');
    assert.equal(session.body.carried, 3);

    const signin = await call('GET', '/api/reading/signin');
    assert.equal(signin.status, 200);
    assert.equal(signin.body.open, false);

    const safari = await call('POST', '/api/reading/signin/safari', {});
    assert.equal(safari.status, 200);
    assert.equal(safari.body.browser, 'Safari');

    const retry = await call('POST', '/api/reading/retry', {});
    assert.equal(retry.status, 200);

    const closed = await call('POST', '/api/reading/close', {});
    assert.equal(closed.status, 200);
    assert.ok(reader.calls.some((c) => c[0] === 'close'));
  });
});

test('an input kind the reader has no meaning for is a 400, not a 200 saying ok:false', async () => {
  await withServer(recordingReader(), async (call) => {
    const res = await call('POST', '/api/reading/input', { kind: 'wiggle' });
    assert.equal(res.status, 400, 'the caller sent something this API does not have');
    assert.match(res.body.error, /unknown input "wiggle"/);
    assert.match(res.body.error, /Remedy/, 'and it says what the kinds are');
  });
});

test('a reader that is not open refuses the input routes with 409 rather than throwing', async () => {
  const reader = recordingReader();
  reader.running = false;
  await withServer(reader, async (call) => {
    assert.equal((await call('POST', '/api/reading/input', { kind: 'turn' })).status, 409);
    assert.equal((await call('GET', '/api/reading/text')).status, 409);
  });
});
