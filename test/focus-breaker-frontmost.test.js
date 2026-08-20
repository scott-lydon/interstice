import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontmostBreaker, decideFrontmost, PANEL_APPS } from '../lib/focus/breakers/frontmost.js';

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
  // S4: encoded as a constant. Even with the panel on the blacklist, it is whitelisted.
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
  // because the shipped one lives only in config/interstice.config.default.json (UC-PRIN-001).
  const breaker = createFrontmostBreaker({ blacklistApps: ['Slack'], frontmost: async () => null });
  assert.equal(await breaker.probe(AT), null);
});
