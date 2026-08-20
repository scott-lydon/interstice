// Each focus default used to be stated three times: as a literal in the module that
// consumes it, as a value in config/interstice.config.default.json, and again in README.md. Three
// copies of one number is three chances to disagree, and the panel-size copy in the README had
// already drifted from the config by 200 points before anyone noticed.
//
// So the shipped file is now the only place a default is written down. The modules take the value
// and refuse to invent one, the tracker fills a partial config from the shipped file rather than
// from literals, and the README copy is pinned by test/readme-quotes.test.js. This test holds all
// of that in place, including against the easy regression of someone adding `= 25` back as a
// convenience.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createMachine } from '../lib/focus/blocks.js';
import { createFrontmostBreaker } from '../lib/focus/breakers/frontmost.js';
import { createVideoBreaker } from '../lib/focus/breakers/video.js';
import { createFocusTracker } from '../lib/focus/tracker.js';
import { ROOT } from '../lib/paths.js';

const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'interstice.config.default.json'), 'utf8')).focus;

test('a focus part refuses to invent a default, and says where the real one lives', () => {
  for (const [what, build] of [
    ['createMachine', () => createMachine({})],
    ['createFrontmostBreaker', () => createFrontmostBreaker({})],
    ['createVideoBreaker', () => createVideoBreaker({ whitelist: [] })],
  ]) {
    assert.throws(build, /config\/interstice\.config\.default\.json/, `${what} must name the file that ships the value`);
  }
});

test('a tracker built with no config runs on the shipped values, not on literals', () => {
  // No stars store call and no timer: `status` is read without ever starting it.
  const tracker = createFocusTracker({ config: {}, stars: { award: () => {} }, breakers: [] });
  const status = tracker.status('2026-08-19T09:00:00-07:00');
  assert.equal(status.blockMinutes, SHIPPED.blockMinutes);
  assert.equal(status.blockMs, SHIPPED.blockMinutes * 60_000);
});

test('the real breaker roster is built from the shipped config, and describes those values', () => {
  const tracker = createFocusTracker({ config: {}, stars: { award: () => {} } });
  const described = tracker.status('2026-08-19T09:00:00-07:00').breakers;
  const byName = Object.fromEntries(described.map((b) => [b.name, b.describe]));

  assert.match(byName['frontmost-app'], new RegExp(`\\(${SHIPPED.blacklistApps.length} on the list\\)`),
    'the frontmost breaker was handed the shipped blacklist');
  assert.match(byName.video, new RegExp(`${SHIPPED.videoBreakAfterMs}ms`),
    'the video breaker was handed the shipped debounce');
});

/**
 * The regression guard. A default literal is easy to add back and costs nothing until the day the
 * config moves, so the shipped values are asserted absent from the code that consumes them.
 */
test('no shipped focus default is restated as a literal in the focus modules', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [
    'lib/focus/blocks.js',
    'lib/focus/tracker.js',
    'lib/focus/breakers/frontmost.js',
    'lib/focus/breakers/video.js',
  ];
  for (const file of files) {
    const code = strip(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const app of SHIPPED.blacklistApps) {
      assert.ok(!code.includes(`'${app}'`), `${file} restates the blacklist app "${app}"; the config file is its only home`);
    }
    for (const host of SHIPPED.videoWhitelist) {
      assert.ok(!code.includes(`'${host}'`), `${file} restates the whitelist entry "${host}"`);
    }
    assert.ok(!new RegExp(`=\\s*${SHIPPED.videoBreakAfterMs}\\b`).test(code), `${file} restates videoBreakAfterMs as a default`);
    assert.ok(!new RegExp(`=\\s*${SHIPPED.blockMinutes}\\b`).test(code), `${file} restates blockMinutes as a default`);
  }
});
