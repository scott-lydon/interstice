import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { carryAmazonSession, hasAmazonSession, defaultChromeCookies } from '../lib/amazon-session.js';

/**
 * The panel has its own browser profile, so Amazon does not know you there and the
 * reading rung lands on a sign-in page instead of on your book. The session moves
 * across rather than being recreated, and the two things that must hold are that it
 * arrives and that nothing else comes with it.
 */

const sqlite = (file, sql) => execFileSync('/usr/bin/sqlite3', [file, sql], { encoding: 'utf8' }).trim();

function cookieStore(dir, rows) {
  const file = path.join(dir, 'Cookies');
  sqlite(
    file,
    'CREATE TABLE cookies (creation_utc INTEGER PRIMARY KEY, host_key TEXT, name TEXT, encrypted_value BLOB);'
  );
  for (const [i, r] of rows.entries()) {
    sqlite(file, `INSERT INTO cookies VALUES (${i + 1}, '${r.host}', '${r.name}', x'00');`);
  }
  return file;
}

test('the Amazon session is carried, and nothing else is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookie-test-'));
  const from = cookieStore(dir, [
    { host: '.amazon.com', name: 'at-main' },
    { host: 'read.amazon.com', name: 'session-id' },
    { host: '.yourbank.example', name: 'session' },
    { host: '.mail.example', name: 'auth' },
  ]);
  const to = path.join(dir, 'panel', 'Default', 'Cookies');

  const result = await carryAmazonSession({ from, to });
  assert.equal(result.carried, 2, 'both Amazon rows arrived');

  const hosts = sqlite(to, 'SELECT DISTINCT host_key FROM cookies ORDER BY host_key;').split('\n');
  assert.deepEqual(hosts, ['.amazon.com', 'read.amazon.com'], 'and nothing from any other site');
  assert.equal(await hasAmazonSession(to), true);
});

test('carrying again does not disturb a session that is already there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookie-test-'));
  const from = cookieStore(dir, [{ host: '.amazon.com', name: 'at-main' }]);
  const to = path.join(dir, 'panel', 'Default', 'Cookies');
  await carryAmazonSession({ from, to });
  const again = await carryAmazonSession({ from, to });
  assert.equal(again.carried, 0);
  assert.match(again.reason, /already signed in/);
});

test('a browser that is not signed in carries nothing, and says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookie-test-'));
  // Cookies for the site, but not the one that means you are signed in.
  const from = cookieStore(dir, [{ host: '.amazon.com', name: 'i18n-prefs' }]);
  const result = await carryAmazonSession({ from, to: path.join(dir, 'panel', 'Cookies') });
  assert.equal(result.carried, 0);
  assert.match(result.reason, /not signed in/);
});

test('a missing source is a reason, never a crash', async () => {
  const result = await carryAmazonSession({ from: '/nonexistent/Cookies', to: '/nonexistent/out' });
  assert.equal(result.carried, 0);
  assert.equal(await hasAmazonSession('/nonexistent/Cookies'), false);
});

test('the source is your ordinary Chrome profile, not a guess', () => {
  const p = defaultChromeCookies({ home: '/Users/someone' });
  assert.equal(p, '/Users/someone/Library/Application Support/Google/Chrome/Default/Cookies');
});
