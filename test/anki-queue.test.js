import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rankDecks } from '../lib/state/anki.js';
import { ROOT } from '../lib/paths.js';

/**
 * "Least studied" has to mean the deck you have put the least into, not the deck
 * with the most cards waiting. Those two orderings disagree on a real collection:
 * the biggest backlog here is a deck reviewed hundreds of times, and the neglected
 * decks are small.
 */

const CARDS = [
  { deckName: 'Multiplication', reps: 9, lapses: 1 },
  { deckName: 'Multiplication', reps: 10, lapses: 0 },
  { deckName: 'Multiplication', reps: 8, lapses: 0 },
  { deckName: 'Salsa', reps: 1, lapses: 0 },
  { deckName: 'Salsa', reps: 1, lapses: 0 },
  { deckName: 'BJJ', reps: 1, lapses: 0 },
];

test('the deck with the fewest reviews per card ranks first', () => {
  const ranked = rankDecks(CARDS);
  assert.equal(ranked[0].meanReps, 1);
  assert.equal(ranked.at(-1).deck, 'Multiplication');
});

test('a large backlog does not make a well-studied deck look neglected', () => {
  const withBacklog = [
    ...Array.from({ length: 200 }, () => ({ deckName: 'Drilled Daily', reps: 12, lapses: 0 })),
    { deckName: 'Never Touched', reps: 1, lapses: 0 },
  ];
  assert.equal(rankDecks(withBacklog)[0].deck, 'Never Touched');
});

test('tied decks are broken by size, because the bigger one is the neglected one', () => {
  // Several decks on this collection sit at exactly 1.0 mean reviews. Between a
  // one-card deck and an eleven-card deck at the same score, the eleven-card deck
  // is the one that was actually skipped.
  const ranked = rankDecks(CARDS);
  assert.equal(ranked[0].deck, 'Salsa');
  assert.equal(ranked[1].deck, 'BJJ');
});

test('ranking is deterministic when size ties too', () => {
  const a = rankDecks([{ deckName: 'Zebra', reps: 1 }, { deckName: 'Apple', reps: 1 }]);
  const b = rankDecks([{ deckName: 'Apple', reps: 1 }, { deckName: 'Zebra', reps: 1 }]);
  assert.deepEqual(a.map((d) => d.deck), b.map((d) => d.deck));
  assert.equal(a[0].deck, 'Apple');
});

test('decks with nothing due are never ranked at all', () => {
  // rankDecks only ever sees due cards, which is what keeps the top rung from
  // delivering into an empty deck.
  assert.deepEqual(rankDecks([]), []);
});

test('cards are answered through the collection, not by driving Anki\'s window', () => {
  // guiAnswerCard needs the reviewer open and showing that card, which means Anki
  // must be raised. answerCards schedules directly, so the review is real and
  // recorded while Anki stays where it is.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'state', 'anki.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  assert.ok(/'answerCards'/.test(code), 'answers go through answerCards');
  assert.ok(!/invoke\(\s*'guiAnswerCard'/.test(code), 'nothing drives the reviewer window');
  assert.ok(!/invoke\(\s*'guiDeckReview'/.test(code), 'nothing opens a deck in Anki itself');
});
