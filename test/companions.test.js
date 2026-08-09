import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesBinaural,
  parseFrame,
  warnings,
  coversMenuBar,
  verdictFromSamples,
} from '../lib/state/companions.js';
import { defaults } from '../lib/config.js';

const PATTERN = defaults().companions.binaural.match;

test('the shipped pattern recognises the track that is actually played', () => {
  assert.equal(
    matchesBinaural(
      'ytmp3free.cc_40hz-gamma-binaural-beats-ambient-study-music-for-focus-and-concentration',
      PATTERN
    ),
    true
  );
});

test('ordinary music is not mistaken for a work track', () => {
  for (const track of ['Blue in Green', 'The Rite of Spring', 'Interstellar Main Theme']) {
    assert.equal(matchesBinaural(track, PATTERN), false, track);
  }
});

test('nothing playing is not a match, and a broken pattern does not throw', () => {
  assert.equal(matchesBinaural(null, PATTERN), false);
  assert.equal(matchesBinaural('40hz gamma', '('), false);
});

test('a status item frame is parsed, and its failure modes are named', () => {
  assert.deepEqual(parseFrame('991 5 70 22\n'), { ok: true, x: 991, y: 5, width: 70, height: 22 });
  assert.deepEqual(parseFrame('991, 5, 70, 22'), { ok: true, x: 991, y: 5, width: 70, height: 22 });
  assert.equal(parseFrame('no-process').ok, false);
  assert.equal(parseFrame('no-status-item').ok, false);
  assert.equal(parseFrame('whatever it said').ok, false);
});

/**
 * The strip is only worth photographing if the menu bar is the thing in front of
 * the camera. An ordinary window sits below it and must not count as covering it,
 * or every reading turns into "unknown" and the check is dead weight.
 */
test('only a window reaching into the menu bar counts as covering it', () => {
  const item = { x: 991, y: 5, width: 70, height: 22 };
  assert.equal(coversMenuBar({ x: 0, y: 0, width: 1470, height: 956 }, item), true, 'full screen');
  assert.equal(coversMenuBar({ x: 0, y: 25, width: 1470, height: 900 }, item), false, 'maximised below the bar');
  assert.equal(coversMenuBar({ x: 0, y: 0, width: 400, height: 300 }, item), false, 'top left, nowhere near');
  assert.equal(coversMenuBar({ x: 900, y: 5, width: 300, height: 200 }, item), true, 'drawn over the bar');
});

/**
 * A false "counting down" was produced on a real menu bar by something crossing the
 * strip once between two samples. Two samples cannot tell that from a tick; three
 * can, because a countdown changes across every consecutive pair.
 */
test('a tick changes every pair; a thing that crosses once changes one', () => {
  assert.equal(verdictFromSamples([true, true]), 'on');
  assert.equal(verdictFromSamples([false, false]), 'paused');
  assert.equal(verdictFromSamples([true, false]), 'unknown');
  assert.equal(verdictFromSamples([false, true]), 'unknown');
});

/**
 * The distinction the whole feature rests on: a companion we could not read must
 * not produce a warning. A nag fired on a reading we never took is a nag you learn
 * to ignore, and then the real ones stop working too.
 */
test('unknown never warns; off, paused and playing-something-else do', () => {
  const got = warnings([
    { key: 'binaural', verdict: 'unknown' },
    { key: 'pomodoro', verdict: 'on' },
    { key: 'a', verdict: 'off' },
    { key: 'b', verdict: 'paused' },
    { key: 'c', verdict: 'other' },
  ]).map((c) => c.key);
  assert.deepEqual(got, ['a', 'b', 'c']);
});
