import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover, resolveEndpoint, FALLBACK, addonConfigPath } from '../lib/state/anki-discovery.js';

/**
 * Regression guard for the first thing that broke on a real machine.
 *
 * AnkiConnect's documented default port is 8765, but it is user editable. The
 * development host runs it on 8766, so a hardcoded 8765 left the flashcard rung
 * permanently unavailable with no error anywhere: the exact silent-null failure
 * this project is built to avoid.
 */

function fakeHome(configObject) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-anki-'));
  if (configObject !== undefined) {
    const dir = path.dirname(addonConfigPath({ home }));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(addonConfigPath({ home }), JSON.stringify(configObject));
  }
  return home;
}

test('reads a non-default port from the addon config', () => {
  const home = fakeHome({ webBindAddress: '127.0.0.1', webBindPort: 8766, apiKey: null });
  const got = discover({ home });
  assert.equal(got.url, 'http://127.0.0.1:8766');
  assert.equal(got.source, 'addon-config');
});

test('falls back to the documented default when no addon config exists', () => {
  const home = fakeHome(undefined);
  const got = discover({ home });
  assert.equal(got.url, FALLBACK.url);
  assert.equal(got.source, 'default');
});

test('a corrupt addon config falls back rather than throwing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-anki-'));
  const p = addonConfigPath({ home });
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ this is not json');
  assert.equal(discover({ home }).url, FALLBACK.url);
});

test('a 0.0.0.0 bind is contacted over loopback, not the wildcard', () => {
  const home = fakeHome({ webBindAddress: '0.0.0.0', webBindPort: 9000 });
  assert.equal(discover({ home }).url, 'http://127.0.0.1:9000');
});

test('an api key in the addon config is picked up', () => {
  const home = fakeHome({ webBindPort: 8765, apiKey: 'sekrit' });
  assert.equal(discover({ home }).apiKey, 'sekrit');
});

test('an explicit url in interstice config always wins over discovery', () => {
  const home = fakeHome({ webBindPort: 8766 });
  const got = resolveEndpoint({ anki: { url: 'http://127.0.0.1:1234' } }, { home });
  assert.equal(got.url, 'http://127.0.0.1:1234');
  assert.equal(got.source, 'config');
});

test('a null url in interstice config means discover', () => {
  const home = fakeHome({ webBindPort: 8766 });
  const got = resolveEndpoint({ anki: { url: null } }, { home });
  assert.equal(got.url, 'http://127.0.0.1:8766');
});

test('a missing port key still yields the documented default', () => {
  const home = fakeHome({ webBindAddress: '127.0.0.1' });
  assert.equal(discover({ home }).url, 'http://127.0.0.1:8765');
});
