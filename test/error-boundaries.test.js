// Four boundaries in this repo used to answer a real fault with the
// same value they answer an ordinary absence with: a malformed line of logs/gaps.jsonl was skipped
// in silence, a request body that would not parse became `{}`, a corrupt reading cache became the
// same null as a cache that was never written, and a URL the probe could not parse became the host
// `''`, which then flowed into whitelist matching as though it were a host.
//
// Each of those makes a wrong answer indistinguishable from a right one, and none of them is a
// long-lived loop boundary where swallowing is correct. These tests pin the distinction: the
// absence still answers as an absence, and the fault now says what it was and where.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readJsonl, readJsonlWithErrors, appendJsonl } from '../lib/logger.js';
import { recallBooks, rememberBooks } from '../lib/state/kindle.js';
import { READING_CACHE } from '../lib/paths.js';
import { toVideoRecords } from '../lib/video/probe.js';
import { createVideoBreaker } from '../lib/focus/breakers/video.js';
import { createServer } from '../lib/server.js';
import { defaults } from '../lib/config.js';
import { readOrCreateToken } from '../lib/auth.js';
import { LOG_DIR } from '../lib/paths.js';

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-err-')), name);

test('a malformed jsonl line is reported by 1-based line number, not skipped in silence', () => {
  const file = tmp('gaps.jsonl');
  // Written through the real append path, so the good lines are exactly the shape the daemon
  // writes, and the bad one is the truncation a kill or a full disk actually leaves behind.
  appendJsonl(file, { id: 'a', durationSec: 10 });
  fs.appendFileSync(file, '{"id":"b","durationSec":\n');
  appendJsonl(file, { id: 'c', durationSec: 30 });

  const { records, malformed } = readJsonlWithErrors(file);
  assert.deepEqual(records.map((r) => r.id), ['a', 'c'], 'the readable records still come back');
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].line, 2, 'the line number is 1-based, as an editor counts');
  assert.ok(malformed[0].error.length > 0, 'the parse error is carried, not discarded');
  assert.match(malformed[0].preview, /"id":"b"/, 'the line itself is quoted so it can be found');

  // The plain call is unchanged for the many callers that cannot act on a parse failure.
  assert.deepEqual(readJsonl(file).map((r) => r.id), ['a', 'c']);
});

test('a missing jsonl file is an absence, not a fault', () => {
  const { records, malformed } = readJsonlWithErrors(tmp('never-written.jsonl'));
  assert.deepEqual(records, []);
  assert.deepEqual(malformed, [], 'a file that does not exist has no malformed lines');
});

test('a request body that is not JSON answers 400 naming the parse error, not 200 with {}', async (t) => {
  const PORT = 7524; // a port of its own, so this never collides with a running daemon
  const config = { ...defaults(), port: PORT };
  const daemon = {
    health: () => ({ ok: true }),
    panel: { state: () => ({}), ping() {} },
    focus: { status: () => ({}) },
    latency: { active: () => [] },
    engine: { status: { state: 'idle' } },
    stars: { starsForDay: () => [], starsForMonth: () => [] },
  };
  const token = readOrCreateToken(LOG_DIR);
  const srv = await createServer({ daemon, config });
  t.after(() => srv.close());

  const post = (pathname, body) =>
    fetch(`http://127.0.0.1:${PORT}${pathname}`, {
      method: 'POST',
      headers: { 'x-interstice-token': token },
      body,
    });

  // A truncated body. Before, this was `{}`, so the route answered "empty" about a
  // body that did contain text, and the one true fact went unsaid.
  const res = await post('/api/queued', '{"text":"hello"');
  assert.equal(res.status, 400, 'a body this daemon cannot parse is the caller\'s error, not a 500');
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /not valid JSON/);
  assert.ok(body.parseError.length > 0, 'the parser\'s own message is passed through');
  assert.equal(body.bytes, 15, 'the size received is reported');
  // Not a substring check: the parse error's own remedy says "send no body at all for an empty
  // one", so /empty/ matches it legitimately. The defect being pinned is the route answering
  // WITH the business error, which is the exact string 'empty'.
  assert.notEqual(body.error, 'empty', 'a parse failure is never reported as a business error');

  // No body at all still means "no arguments", which several routes rely on: this one answers on
  // its own terms (the field is missing) rather than as a parse failure.
  const empty = await post('/api/queued', undefined);
  assert.equal(empty.status, 400);
  const emptyBody = await empty.json();
  assert.doesNotMatch(emptyBody.error, /not valid JSON/, 'an absent body is an empty object, not a parse error');
});

test('a corrupt reading cache is reported as a fault; a cache that was never written is not', () => {
  const had = fs.existsSync(READING_CACHE) ? fs.readFileSync(READING_CACHE) : null;
  try {
    // Corrupt: the file exists and will not parse. This is the state a half-finished write leaves.
    fs.mkdirSync(path.dirname(READING_CACHE), { recursive: true });
    fs.writeFileSync(READING_CACHE, '{"at":1,"book":{"asin":"B0');
    const faults = [];
    assert.equal(recallBooks({ onFault: (f) => faults.push(f) }), null, 'a corrupt cache has no book in it');
    assert.equal(faults.length, 1, 'and says so, rather than reading as "you have never read anything"');
    assert.equal(faults[0].reason, 'cache_corrupt');
    assert.equal(faults[0].file, READING_CACHE);

    // Absent: the ordinary first run. Same null, and no fault, because nothing went wrong.
    fs.rmSync(READING_CACHE, { force: true });
    const none = [];
    assert.equal(recallBooks({ onFault: (f) => none.push(f) }), null);
    assert.deepEqual(none, [], 'never written is not a fault');

    // And a cache that is intact still comes back, which is the case the fault must not break.
    rememberBooks({ book: { asin: 'B0046LU7H0', title: 'A Book', percent: 39 }, shelf: [] });
    const back = [];
    assert.equal(recallBooks({ onFault: (f) => back.push(f) }).book.asin, 'B0046LU7H0');
    assert.deepEqual(back, []);
  } finally {
    if (had === null) fs.rmSync(READING_CACHE, { force: true });
    else fs.writeFileSync(READING_CACHE, had);
  }
});

test('a URL the probe cannot parse reports no host and why, instead of the host ""', () => {
  const [rec] = toVideoRecords([{ browser: 'Chrome', url: 'http://#nothing-here', playing: true }]);
  assert.equal(rec.host, null, 'an unnameable source has no host, and "" is a host');
  assert.ok(rec.hostError.length > 0, 'the reason is carried on the record');
  assert.equal(rec.playing, true, 'the row is kept: a source we cannot name must still be able to break');

  const good = toVideoRecords([{ browser: 'Chrome', url: 'https://WWW.Udemy.com/x', playing: false }]);
  assert.equal(good[0].host, 'www.udemy.com');
  assert.equal(good[0].hostError, null);
});

test('two sources with no nameable host do not debounce each other into one', async () => {
  // Both used to report host "", so the second tick looked like continuous playback from the same
  // source and completed a debounce window that no single source had earned.
  let which = 0;
  const rows = ['http://#one', 'http://#two'];
  const breaker = createVideoBreaker({
    whitelist: [],
    breakAfterMs: 4000,
    probe: async () => toVideoRecords([{ browser: 'Chrome', url: rows[which], playing: true }]),
  });

  assert.equal(await breaker.probe('2026-08-19T09:00:00-07:00'), null, 'first sighting starts the clock');
  which = 1;
  const later = await breaker.probe('2026-08-19T09:00:05-07:00');
  assert.equal(later, null, 'a different unnameable source restarts the clock rather than completing it');

  // The same source, seen continuously, does break: the debounce still works.
  which = 0;
  await breaker.probe('2026-08-19T09:00:06-07:00');
  const broke = await breaker.probe('2026-08-19T09:00:11-07:00');
  assert.equal(broke?.cause, 'video');
  assert.equal(broke.detail.host, null);
  assert.equal(broke.detail.url, 'http://#one', 'a break with no nameable host still names the source');
});
