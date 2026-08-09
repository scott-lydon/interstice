import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBody, decode, scoreNote, QUALIFIES } from '../lib/state/notes.js';
import { itemKey, applyOverrides, openCount } from '../lib/todo-store.js';

/**
 * These fixtures are the shapes Notes actually emits on this machine, taken from
 * the operator's own lists. Notes does not nest a sublist *inside* its parent
 * `<li>`; it opens a fresh `<ul>` as the item's sibling, so depth has to be tracked
 * from the tag stream. A parser written against the tree you would expect returns
 * a flat list and loses every sub-item.
 */

const NESTED = `<div>ToDO </div>
<ul>
<li>ACAT Transfer</li>
</ul>
<div><br></div>
<div>Working: </div>
<ul>
<li>Implement this<br></li>
<ul>
<li>Anki trigger when agents start working.  (Goal loop) </li>
<li>Hate this, it just pops up instead of streaming into one interface.  </li>
</ul>
<li>Global handoff (cowork) </li>
</ul>`;

test('sub-items keep their depth even though Notes nests them as siblings', () => {
  const items = parseBody(NESTED, { noteId: 'n1' });
  assert.deepEqual(
    items.map((i) => [i.depth, i.text]),
    [
      [1, 'ACAT Transfer'],
      [1, 'Implement this'],
      [2, 'Anki trigger when agents start working. (Goal loop)'],
      [2, 'Hate this, it just pops up instead of streaming into one interface.'],
      [1, 'Global handoff (cowork)'],
    ]
  );
});

test('prose between lists does not get glued onto the previous item', () => {
  // "Working:" sits in a <div> between two <ul>s. An earlier pass that collected
  // every text run appended it to "ACAT Transfer".
  const items = parseBody(NESTED, { noteId: 'n1' });
  assert.ok(!items.some((i) => /Working/.test(i.text)), 'a heading became a to-do item');
});

test('markdown checkboxes pasted into a note are read as state, not as text', () => {
  const items = parseBody('<ul><li>- [x] Book the flight</li><li>- [ ] Pack</li></ul>');
  assert.deepEqual(items.map((i) => [i.text, i.doneInNote]), [['Book the flight', true], ['Pack', false]]);
});

test('a native Notes checklist reports its ticks', () => {
  const items = parseBody('<ul class="checklist"><li checked>Done thing</li><li>Open thing</li></ul>');
  assert.deepEqual(items.map((i) => i.doneInNote), [true, false]);
});

test('entities and non-breaking spaces survive the trip', () => {
  assert.equal(decode('Tom &amp; Jerry&nbsp;'), 'Tom & Jerry ');
  assert.equal(decode('&quot;quoted&quot;'), '"quoted"');
  const items = parseBody('<ul><li>Ask about R&amp;D</li></ul>');
  assert.equal(items[0].text, 'Ask about R&D');
});

test('empty items are dropped rather than shown as blank rows', () => {
  assert.equal(parseBody('<ul><li></li><li><br></li><li>Real</li></ul>').length, 1);
});

test('the item cap is honoured so one enormous note cannot fill the panel', () => {
  const many = '<ul>' + Array.from({ length: 500 }, (_, i) => `<li>item ${i}</li>`).join('') + '</ul>';
  assert.equal(parseBody(many, { maxItems: 50 }).length, 50);
});

test('a note titled like a list outranks a note that merely contains bullets', () => {
  // Most bulleted notes are transcripts and meeting notes. Scoring the body above
  // the title fills the rung with things you were never going to do.
  assert.ok(
    scoreNote({ name: 'ToDO' }, '<ul><li>a</li></ul>') >
    scoreNote({ name: 'Call with Mary' }, '<ul><li>a</li></ul>')
  );
});

test('a note full of boxes qualifies even when its heading says nothing', () => {
  // The note that prompted this was headed `interstice:` and was a list of `[ ]`
  // lines. Screening on the title alone never opened it, so it never got the chance
  // to qualify on the boxes it was made of, and the newest list on the machine was
  // the one list the rung could not see.
  const body = '<div>interstice: </div><div>[ ] stop opening my notes app</div>'
    + '<div>[ ] reuse the window that is already open</div>';
  assert.ok(
    scoreNote({ name: 'interstice:' }, body) >= QUALIFIES,
    'bracket checkboxes are checkboxes with or without a bullet in front of them'
  );
});

test('a bulleted note that is not a list stays off the rung', () => {
  // Recency now puts notes in front of the scorer that a title screen would have
  // kept out, so the bar has to hold: transcripts and call notes have bullets too.
  assert.ok(
    scoreNote({ name: 'Call with Mary' }, '<ul><li>she is sending the contract</li></ul>') < QUALIFIES
  );
});

/* --------------------------------------------------------- tracking done ---- */

test('an item keeps its identity when the list is reordered', () => {
  // Keys are text-based, not positional, because you add lines above things all
  // day and a finished item must stay finished.
  const a = itemKey({ noteId: 'n1', text: 'Pack the bag', depth: 1 });
  const b = itemKey({ noteId: 'n1', text: '  pack the   bag ', depth: 1 });
  assert.equal(a, b, 'whitespace and case do not change identity');
  assert.notEqual(a, itemKey({ noteId: 'n2', text: 'Pack the bag', depth: 1 }));
});

test('ticking here beats what the note says, because it is the later statement', () => {
  const lists = [{ title: 'ToDO', items: parseBody('<ul><li>- [x] Old tick</li><li>Fresh</li></ul>', { noteId: 'n1' }) }];
  const key = itemKey(lists[0].items[0]);
  const merged = applyOverrides(lists, new Map([[key, { key, done: false, ts: 5 }]]));
  assert.equal(merged[0].items[0].done, false, 'the local decision wins');
  assert.equal(merged[0].items[0].source, 'interstice');
  assert.equal(merged[0].counts.open, 2);
});

test('a list with nothing left open reports zero work', () => {
  const lists = [{ title: 'ToDO', items: parseBody('<ul><li>- [x] a</li><li>- [x] b</li></ul>', { noteId: 'n1' }) }];
  assert.equal(openCount(applyOverrides(lists, new Map())), 0);
});
