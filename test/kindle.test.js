import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  asinOf,
  describeBook,
  kindleState,
  installedKindles,
  pickBooks,
  mayReadStore,
  rememberBooks,
  recallBooks,
} from '../lib/state/kindle.js';
import { READING_CACHE } from '../lib/paths.js';

/**
 * "Recently read but unfinished" is the whole rung, and every part of that phrase
 * is a way to get it wrong: recently *touched* is not recently read, and Kindle's
 * own read flag does not mean finished.
 */

/**
 * A store we cannot read must not read as "you have no books". macOS puts another
 * app's container behind Full Disk Access, which a launchd job cannot ask for, so
 * this is a state the daemon reaches on an ordinary machine.
 */
test('what was last read survives a refusal, and carries the time it was taken', () => {
  // The cache file belongs to the running daemon; whatever is in it goes back.
  const had = fs.existsSync(READING_CACHE) ? fs.readFileSync(READING_CACHE) : null;
  try {
    const book = { asin: 'B0046LU7H0', title: 'A Book', percent: 39, position: 1, end: 3 };
    rememberBooks({ book, shelf: [] });
    const back = recallBooks();
    assert.equal(back.book.asin, 'B0046LU7H0');
    assert.ok(back.at > 0, 'a remembered reading knows when it was taken');
    // Nothing to remember is not the same as remembering nothing.
    assert.equal(rememberBooks({ book: null }).book, null);
  } finally {
    if (had === null) fs.rmSync(READING_CACHE, { force: true });
    else fs.writeFileSync(READING_CACHE, had);
  }
});

/**
 * A read of this store can block at the filesystem level for minutes, and node
 * cannot cancel one it has already handed to the threadpool. Abandoning it is
 * right; letting the abandoned one lock the rung out for the rest of the day is
 * not, and the first version of this did exactly that.
 */
test('an abandoned read blocks the next one briefly, then lets it try again', () => {
  const opts = { retryAfterMs: 30000, max: 2 };
  assert.equal(mayReadStore(undefined, { ...opts, now: 1000 }), true, 'nothing outstanding');
  assert.equal(mayReadStore({ count: 0, startedAt: 0 }, { ...opts, now: 1000 }), true, 'all settled');

  const stuck = { count: 1, startedAt: 1000 };
  assert.equal(mayReadStore(stuck, { ...opts, now: 5000 }), false, 'one just started: use what we know');
  assert.equal(mayReadStore(stuck, { ...opts, now: 40000 }), true, 'long abandoned: try again');

  // Never more than two out at once: the threadpool has four threads, and a daemon
  // with none left has no asynchronous I/O anywhere, not just here.
  assert.equal(mayReadStore({ count: 2, startedAt: 1000 }, { ...opts, now: 999999 }), false);
});

test('a remembered library is never dressed up as a live reading', async () => {
  const state = await kindleState({ reading: { app: 'Amazon Kindle' } });
  if (state.book) {
    assert.equal(typeof state.stale, 'boolean', 'every answer says whether it is remembered');
    if (state.stale) assert.ok(state.staleSince > 0, 'and when it was taken');
  }
});

/**
 * The rung opens the first book without asking, so what lands in position one is
 * the whole decision. Everything else is the shelf, which you go looking for.
 */
test('one book is opened and the rest become the shelf, in order', () => {
  const { book, shelf } = pickBooks([
    { title: 'newest', asin: 'B000000001', finished: false },
    { title: 'finished', asin: 'B000000002', finished: true },
    { title: 'older', asin: 'B000000003', finished: false },
  ]);
  assert.equal(book.title, 'newest');
  assert.deepEqual(shelf.map((b) => b.title), ['older'], 'finished books are on neither');
});

test('a book with no ASIN cannot be opened, so it is offered on neither', () => {
  const { book, shelf } = pickBooks([
    { title: 'sideloaded', asin: null, finished: false },
    { title: 'from Amazon', asin: 'B000000004', finished: false },
  ]);
  assert.equal(book.title, 'from Amazon');
  assert.deepEqual(shelf, []);
});

test('nothing unfinished means nothing to open, not an empty-looking book', () => {
  assert.deepEqual(pickBooks([{ title: 'done', asin: 'B000000005', finished: true }]), {
    book: null,
    shelf: [],
  });
});

test('the ASIN is extracted from Kindle\'s composite book id', () => {
  assert.equal(asinOf('A:B0046LU7H0-0'), 'B0046LU7H0');
  assert.equal(asinOf('B0046LU7H0'), 'B0046LU7H0');
  assert.equal(asinOf(null), null);
});

test('progress is measured against the end reading location, not the file size', () => {
  const b = describeBook({
    bookId: 'A:B0046LU7H0-0', title: 'Early Retirement Extreme',
    lastAccess: 1785712366, position: 226766, maxPosition: 610047, erl: 575835,
  });
  // ERL is where the book ends; max position includes back matter, so using it
  // would report every finished book as 90-something per cent and never retire it.
  assert.equal(b.end, 575835);
  assert.equal(b.percent, 39);
  assert.equal(b.finished, false);
});

test('max position is the fallback when the end location is unknown', () => {
  const b = describeBook({ bookId: 'A:X123456789-0', title: 'x', lastAccess: 1, position: 50, maxPosition: 100, erl: -1 });
  assert.equal(b.end, 100);
  assert.equal(b.percent, 50);
});

test('a book read to the end is finished and will not be offered again', () => {
  const b = describeBook({ bookId: 'A:X123456789-0', title: 'x', lastAccess: 1, position: 990, maxPosition: 1000, erl: 1000 });
  assert.equal(b.finished, true);
});

test('a book with no position at all reports unknown progress rather than zero', () => {
  const b = describeBook({ bookId: 'A:X123456789-0', title: 'x', lastAccess: 1, position: 10, maxPosition: 0, erl: -1 });
  assert.equal(b.progress, null);
  assert.equal(b.finished, false);
});

/**
 * The rest runs against a real Core Data store built here, because the query is the
 * part that breaks: column names, the position filter, and the ordering.
 */
function fixtureHome(rows) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-kindle-test-'));
  const dir = path.join(home, 'Library/Containers/com.amazon.Lassen/Data/Library/Protected');
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, 'BookData.sqlite');
  const values = rows
    .map((r) => `('${r.id}','${r.title}',${r.lastAccess},${r.position},${r.max},${r.erl})`)
    .join(',');
  execFileSync('/usr/bin/sqlite3', [
    db,
    `CREATE TABLE ZBOOK (ZBOOKID VARCHAR, ZDISPLAYTITLE VARCHAR, ZRAWLASTACCESSTIME INTEGER,
       ZRAWCURRENTPOSITION INTEGER, ZRAWMAXPOSITION INTEGER, ZRAWERL INTEGER,
       ZRAWREADSTATE INTEGER DEFAULT 0, ZRAWISUNREAD INTEGER DEFAULT 0);
     INSERT INTO ZBOOK (ZBOOKID,ZDISPLAYTITLE,ZRAWLASTACCESSTIME,ZRAWCURRENTPOSITION,ZRAWMAXPOSITION,ZRAWERL)
       VALUES ${values};`,
  ]);
  return home;
}

const installed = installedKindles().length > 0;

test('the most recently read unfinished book wins, and finished ones are passed over', { skip: !installed }, async () => {
  const home = fixtureHome([
    { id: 'A:AAAAAAAAAA-0', title: 'Finished Yesterday', lastAccess: 2000, position: 990, max: 1000, erl: 1000 },
    { id: 'A:BBBBBBBBBB-0', title: 'Half Read Last Week', lastAccess: 1000, position: 400, max: 1000, erl: 1000 },
  ]);
  const state = await kindleState({}, { home });
  assert.equal(state.available, true);
  assert.equal(state.book.title, 'Half Read Last Week');
  assert.equal(state.book.percent, 40);
  assert.equal(state.generation, 'current', 'the newer app is the one queried');
});

test('a book opened but never advanced is not "in progress"', { skip: !installed }, async () => {
  // Position zero means you opened it and bounced off. Routing you back into it is
  // the reading equivalent of delivering an empty deck.
  const home = fixtureHome([
    { id: 'A:CCCCCCCCCC-0', title: 'Opened Once', lastAccess: 9000, position: 0, max: 1000, erl: 1000 },
    { id: 'A:DDDDDDDDDD-0', title: 'Actually Reading', lastAccess: 100, position: 300, max: 1000, erl: 1000 },
  ]);
  const state = await kindleState({}, { home });
  assert.equal(state.book.title, 'Actually Reading');
});

test('an unreadable store leaves the rung available but bookless', { skip: !installed }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-kindle-empty-'));
  const state = await kindleState({}, { home });
  // No visibility is not evidence of no books, but there is still nothing to open.
  assert.equal(state.book, null);
});
