import test from 'node:test';
import assert from 'node:assert/strict';
import { isWhitelisted, registrableDomain, BadVideoURLError } from '../lib/video/whitelist.js';

const WL = ['udemy.com', '*.udemy.com'];

test('the whitelist matches on registrable domain, rejecting lookalikes', () => {
  assert.equal(isWhitelisted('https://www.udemy.com/course/x', WL), true, 'www.udemy.com passes');
  assert.equal(isWhitelisted('https://sub.udemy.com/x', WL), true, 'sub.udemy.com passes');
  assert.equal(isWhitelisted('https://udemy.com.evil.example/x', WL), false, 'a lookalike parent fails');
  assert.equal(isWhitelisted('https://youtube.com/watch?v=1', WL), false, 'youtube fails');
});

test('an empty or malformed URL is a specific error, never a silent pass', () => {
  assert.throws(() => isWhitelisted('', WL), BadVideoURLError);
  assert.throws(() => isWhitelisted('not a url', WL), BadVideoURLError);
});

test('registrableDomain extracts the last two labels', () => {
  assert.equal(registrableDomain('https://a.b.udemy.com/x'), 'udemy.com');
});
