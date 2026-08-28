// The tracker is the join between the pure machine, the breakers and the durable store. Before it
// existed, every one of those modules was tested in isolation and none of them had a caller: the
// feature was implemented and not running. These tests pin the join itself, so a future refactor
// that unwires it fails here rather than shipping a silent no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFocusTracker, localISO } from '../lib/focus/tracker.js';
import { open as openStarStore } from '../lib/focus/store.js';

/** A breaker that fires exactly when the caller says so, with the shared three-function shape. */
function fakeBreaker(name, firing = () => null) {
  return {
    name: () => name,
    describe: () => `test breaker ${name}`,
    async probe(at) {
      const cause = firing(at);
      return cause ? { cause, at, detail: {} } : null;
    },
  };
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-tracker-'));
  return openStarStore(path.join(dir, 'stars.jsonl'));
}

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-08-19T09:00:00-07:00');

test('a full unbroken block awards exactly one durable star', async () => {
  const stars = tmpStore();
  const t = createFocusTracker({
    config: { focus: { blockMinutes: 25 } },
    stars,
    breakers: [fakeBreaker('never')],
  });

  await t.tick(iso(T0)); // arms the block
  await t.tick(iso(T0 + 24 * 60_000)); // one minute short: nothing yet
  assert.equal(stars.all().length, 0, 'a partial block must earn nothing');

  await t.tick(iso(T0 + 25 * 60_000));
  const all = stars.all();
  assert.equal(all.length, 1, 'exactly one star for one completed block');
  assert.equal(all[0].day, '2026-08-19');

  // The star is durable, not in-memory: a second reader of the same file sees it.
  assert.equal(openStarStore(stars.path).all().length, 1);
});

test('each of the three settled break causes forfeits the block in progress', async () => {
  // The real vocabulary: `name()` is the breaker ('frontmost-app'), `cause` is what it emits
  // ('app'). Iterating the names pinned nothing, because the fake breaker echoes whatever it
  // is handed, so the test agreed with itself and not with the product.
  for (const cause of ['app', 'lock', 'video']) {
    const stars = tmpStore();
    let fire = false;
    const t = createFocusTracker({
      config: { focus: { blockMinutes: 25 } },
      stars,
      breakers: [fakeBreaker(cause, () => (fire ? cause : null))],
    });

    await t.tick(iso(T0));
    await t.tick(iso(T0 + 20 * 60_000));
    fire = true;
    const r = await t.tick(iso(T0 + 21 * 60_000));

    assert.equal(r.broke, true, `${cause} must break the block`);
    assert.equal(t.status(iso(T0 + 21 * 60_000)).lastForfeit.cause, cause);

    // The forfeited block earns nothing even though the clock later passes 25 minutes.
    fire = false;
    await t.tick(iso(T0 + 26 * 60_000));
    assert.equal(stars.all().length, 0, `${cause} must forfeit, not defer, the star`);
  }
});

test('a block re-arms once the break clears, and does not restart a running block', async () => {
  const stars = tmpStore();
  let fire = true;
  const t = createFocusTracker({
    config: { focus: { blockMinutes: 25 } },
    stars,
    breakers: [fakeBreaker('video', () => (fire ? 'video' : null))],
  });

  await t.tick(iso(T0)); // breaking, so nothing is armed
  assert.equal(t.status(iso(T0)).phase, 'idle');

  fire = false;
  await t.tick(iso(T0 + 60_000)); // re-arms here
  await t.tick(iso(T0 + 10 * 60_000));
  const s = t.status(iso(T0 + 10 * 60_000));
  assert.equal(s.phase, 'running');
  // Nine minutes, not zero: a tick on a running block must never restart it.
  assert.equal(s.elapsedMs, 9 * 60_000);
});

test('a breaker that throws is a broken sensor, not a break', async () => {
  const stars = tmpStore();
  const warned = [];
  const t = createFocusTracker({
    config: { focus: { blockMinutes: 25 } },
    stars,
    logger: { warn: (m, d) => warned.push(d) },
    breakers: [
      {
        name: () => 'exploding',
        describe: () => 'always throws',
        async probe() {
          throw new Error('ioreg not on PATH');
        },
      },
    ],
  });

  await t.tick(iso(T0));
  await t.tick(iso(T0 + 25 * 60_000));

  assert.equal(stars.all().length, 1, 'a failing sensor must not forfeit an earned block');
  assert.equal(warned.length > 0, true, 'and it must say so rather than fail silently');
  assert.match(warned[0].remedy, /doctor/, 'the warning must name a remedy');
});

test('the daemon wires the tracker and the latency clock, not just the store', async () => {
  // The regression this pins: lib/focus/* and lib/latency.js were fully implemented and tested,
  // and nothing in lib/ or bin/ imported them, so no star could ever be awarded in production.
  const src = fs.readFileSync(new URL('../lib/daemon.js', import.meta.url), 'utf8');
  assert.match(src, /createFocusTracker/, 'daemon must build a focus tracker');
  assert.match(src, /this\.focus\.start\(\)/, 'daemon must start it');
  assert.match(src, /this\.focus\.stop\(\)/, 'and stop it with everything else');
  assert.match(src, /createLatency/, 'daemon must build the latency clock');
  assert.match(src, /latency\.onSubmit/, 'and feed it submits');
  assert.match(src, /latency\.onComplete/, 'and feed it completions');

  const server = fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8');
  assert.match(server, /GET \/api\/focus/, 'the live block and latency state must be reachable');
});

test('the tracker stamps local time, so an evening block is not filed on tomorrow', () => {
  // The regression: the tracker minted `new Date().toISOString()`, which is always UTC. `localDay`
  // reads the day by slicing the first ten characters, so west of Greenwich every block finishing
  // after local 17:00 was stored under tomorrow's date, and one finishing on the last of the month
  // landed in the next month. A real star earned at 23:33 PDT was filed as 2026-08-20.
  const s = localISO();
  assert.match(s, /[+-]\d{2}:\d{2}$/, 'must carry a numeric offset, never a bare Z');
  assert.doesNotMatch(s, /Z$/, 'a UTC stamp is exactly the bug this pins');

  // The day it reports is the LOCAL calendar day, which is the day a star belongs to.
  assert.equal(s.slice(0, 10), new Date().toLocaleDateString('en-CA'));

  // And it survives the boundary that broke it: 23:33 local must stay on its own date.
  const evening = new Date(2026, 7, 19, 23, 33, 21);
  assert.equal(localISO(evening).slice(0, 10), '2026-08-19');
  assert.notEqual(localISO(evening).slice(0, 10), '2026-08-20');
});

/**
 * The tracker wired the breakers in, which was the point of it, but the video breaker
 * was handed `probeVideo` itself where the breaker calls `probe()` with no arguments. `probeVideo`
 * destructures its options, so every tick threw "Cannot read properties of undefined (reading
 * 'browsers')", the catch turned that into a warning and a no-break, and the feature had been off
 * for as long as it had been on: four warnings a minute in logs/launchd.out.log and never one
 * forfeit. A caller that exists but cannot be called is the same as no caller, which is the finding
 * this test closes.
 */
test('the real video breaker can actually be probed, rather than throwing on every tick', async () => {
  const warnings = [];
  const tracker = createFocusTracker({
    config: {},
    stars: { award: () => ({ id: 'x' }) },
    logger: { warn: (msg, extra) => warnings.push({ msg, ...extra }), info: () => {}, error: () => {} },
  });

  await tracker.tick('2026-08-19T09:00:00-07:00');

  const video = warnings.filter((w) => w.breaker === 'video');
  assert.deepEqual(video, [], `the video breaker could not be probed: ${JSON.stringify(video)}`);
});
