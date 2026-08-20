import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontmostBreaker, decideFrontmost, PANEL_APPS, panelIsFrontmost } from '../lib/focus/breakers/frontmost.js';

// A synthetic frontmost signal for a blacklisted app emits exactly one break{cause:'app'};
// an allowlisted app and the Interstice panel itself emit none.

const AT = '2026-08-19T09:10:00-07:00';

test('a blacklisted app frontmost emits exactly one break with cause app', async () => {
  const breaker = createFrontmostBreaker({ blacklistApps: ['Slack'], frontmost: async () => 'Slack' });
  const ev = await breaker.probe(AT);
  assert.ok(ev, 'a break is emitted');
  assert.equal(ev.cause, 'app');
  assert.equal(ev.at, AT);
  assert.match(ev.detail, /Slack/);
});

test('an app not on the blacklist emits no break', async () => {
  const breaker = createFrontmostBreaker({ blacklistApps: ['Slack'], frontmost: async () => 'Terminal' });
  assert.equal(await breaker.probe(AT), null);
});

test('the Interstice panel never breaks its own block, even if blacklisted', () => {
  // Encoded as a constant. Even with the panel on the blacklist, it is whitelisted.
  for (const panel of PANEL_APPS) {
    assert.equal(decideFrontmost({ app: panel, at: AT }, { blacklistApps: [panel, 'Slack'] }), null);
  }
});

test('the match is case-insensitive substring, catching window-suffixed names', () => {
  const ev = decideFrontmost({ app: 'slack (2)', at: AT }, { blacklistApps: ['Slack'] });
  assert.equal(ev.cause, 'app');
});

test('no frontmost app is not a break', async () => {
  // The list is passed explicitly: there is no default blacklist literal in the breaker any more,
  // because the shipped one lives only in config/interstice.config.default.json.
  const breaker = createFrontmostBreaker({ blacklistApps: ['Slack'], frontmost: async () => null });
  assert.equal(await breaker.probe(AT), null);
});

test('the panel never forfeits its own block, even when its browser is blacklisted', () => {
  // The regression: the panel is a Chrome `--app=` window, so the frontmost probe reports the
  // owning application and it reads as "Google Chrome" exactly like any other tab. Whitelisting
  // by name therefore never matched it, and a user who blacklisted their browser forfeited a
  // block by using the thing the block exists for. The pid is what separates our Chrome
  // from theirs.
  const PANEL_PROCESS = 26228;
  const isPanel = (pid) => pid === PANEL_PROCESS;
  const blacklistApps = ['Google Chrome'];

  const usingThePanel = decideFrontmost(
    { app: 'Google Chrome', at: AT, pid: PANEL_PROCESS }, { blacklistApps, isPanel });
  assert.equal(usingThePanel, null, 'the panel is focus, not distraction');

  // The same app name, a different process, is an ordinary browser and still breaks.
  const someOtherChrome = decideFrontmost(
    { app: 'Google Chrome', at: AT, pid: PANEL_PROCESS + 1 }, { blacklistApps, isPanel });
  assert.equal(someOtherChrome.cause, 'app');
  assert.match(someOtherChrome.detail, /Google Chrome/);
});

test('with no panel running there is nothing to exempt, and no crash', () => {
  const noPidFile = () => { throw new Error('ENOENT'); };
  assert.equal(panelIsFrontmost(1234, { read: noPidFile }), false);
  assert.equal(panelIsFrontmost(null, { read: () => '1234' }), false);
  assert.equal(panelIsFrontmost(1234, { read: () => ' 1234\n' }), true);
});
