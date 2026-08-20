// README.md quotes shipped configuration values and shipped product copy,
// there is no generator that writes any of it, and one of the quotes had already gone stale: the
// panel block said 440x620 months after the shipped default became 640x900, so the one document a
// new reader trusts described a window nobody has.
//
// A generator would be the other answer, and it is the worse one here: the README's configuration
// block is a chosen subset, written for a reader rather than dumped, and generating it would mean
// either printing all sixty-odd keys or encoding the subset somewhere else. So the copy stays hand
// written and this test is what keeps it true. Every value in the README's configuration block,
// and the focus bullets named below, is checked against the file it was copied from, and a drift fails here instead of on a reader's screen.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/paths.js';

const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'interstice.config.default.json'), 'utf8'));

/** Every leaf of an object, as dotted path -> value, so a nested quote is checked as deeply as a flat one. */
function leaves(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const at = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, at));
    else out.push([at, v]);
  }
  return out;
}

const at = (obj, dotted) => dotted.split('.').reduce((o, k) => (o === undefined ? undefined : o[k]), obj);

test('the README configuration block quotes the shipped defaults exactly', () => {
  // The block introduced by the line naming the user's config file, which is the one that claims
  // to show what install writes.
  const marker = README.indexOf('`config/interstice.config.json`, created by `install`');
  assert.ok(marker > 0, 'the README still introduces its configuration block the way this test finds it');
  const start = README.indexOf('```json', marker);
  const end = README.indexOf('```', start + 7);
  assert.ok(start > 0 && end > start, 'the configuration block is still a fenced json block');

  const quoted = JSON.parse(README.slice(start + 7, end));
  const checked = leaves(quoted);
  assert.ok(checked.length >= 20, `the block should quote a real subset, found ${checked.length} values`);

  for (const [dotted, value] of checked) {
    const shipped = at(SHIPPED, dotted);
    assert.notEqual(shipped, undefined, `README quotes "${dotted}", which the shipped config has no key for`);
    assert.deepEqual(
      value,
      shipped,
      `README says ${dotted} = ${JSON.stringify(value)}, config/interstice.config.default.json ships ${JSON.stringify(shipped)}`
    );
  }
});

test('the README focus defaults are the shipped focus defaults', () => {
  // Prose rather than JSON, so each one is matched where it is written.
  const blockMinutes = /`focus\.blockMinutes`[^\n]*\(default `(\d+)`\)/.exec(README);
  assert.ok(blockMinutes, 'the README still documents focus.blockMinutes with a default');
  assert.equal(Number(blockMinutes[1]), SHIPPED.focus.blockMinutes);

  const breakAfter = /`focus\.videoBreakAfterMs`[\s\S]*?\(default `(\d+)`\)/.exec(README);
  assert.ok(breakAfter, 'the README still documents focus.videoBreakAfterMs with a default');
  assert.equal(Number(breakAfter[1]), SHIPPED.focus.videoBreakAfterMs);

  // The blacklist is spelled out as a sentence, so every shipped app must appear in it and the
  // sentence must not name one that was removed from the config.
  const blacklist = /`focus\.blacklistApps`[\s\S]*?\(default: ([^)]*)\)/.exec(README);
  assert.ok(blacklist, 'the README still lists the default blacklist');
  const listed = blacklist[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(
    listed,
    SHIPPED.focus.blacklistApps,
    'the README blacklist must be the shipped blacklist, in the shipped order'
  );
});

/**
 * Product copy the README quotes back to the reader. A message that has been reworded in lib/ but
 * not in the README is a document describing an error nobody will ever see.
 */
const QUOTED_COPY = [
  ['AnkiConnect unreachable: ', 'lib/state/anki.js'],
];

test('every product string the README quotes still exists in the code that emits it', () => {
  for (const [quote, file] of QUOTED_COPY) {
    assert.ok(README.includes(quote), `the README no longer quotes "${quote}"; drop it from this list`);
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(source.includes(quote), `README quotes "${quote}" but ${file} no longer emits it`);
  }
});
