import test from 'node:test';
import assert from 'node:assert/strict';
import { isWhitelisted, registrableDomain, BadVideoURLError } from '../lib/video/whitelist.js';

const WL = ['udemy.com', '*.udemy.com'];

test('the whitelist matches the whole host, exactly or as a dot-suffix, rejecting lookalikes', () => {
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

test('a multi-part TLD does not whitelist every host under it', () => {
  // The regression: both the host and the whitelist entry were collapsed to their last two labels,
  // so `bbc.co.uk` became `co.uk` and matched every .co.uk host there is. The comment above the
  // collapse claimed the simplification "fails safe by being stricter". It failed open, which is
  // the one direction a whitelist must never fail: it decides what does NOT forfeit a block.
  assert.equal(isWhitelisted('https://www.bbc.co.uk/x', ['bbc.co.uk']), true, 'its own host still passes');
  assert.equal(isWhitelisted('https://evil.co.uk/x', ['bbc.co.uk']), false, 'a stranger under the same TLD must not');
  assert.equal(isWhitelisted('https://anything.co.uk/x', ['*.bbc.co.uk']), false, 'nor through the wildcard form');
  assert.equal(isWhitelisted('https://evil.com.au/x', ['abc.com.au']), false, 'nor under any other multi-part TLD');
});

test('a lookalike cannot slip past on either side of the name', () => {
  assert.equal(isWhitelisted('https://udemy.com.evil.example/x', ['udemy.com']), false, 'not as a prefix');
  assert.equal(isWhitelisted('https://notudemy.com/x', ['udemy.com']), false, 'not as a suffix');
  assert.equal(isWhitelisted('https://sub.deep.udemy.com/x', ['udemy.com']), true, 'but a real subdomain does');
});
