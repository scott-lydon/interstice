import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { READING_CACHE } from '../paths.js';

const run = promisify(execFile);

/**
 * Which book to go back to, and where in it.
 *
 * Two Kindle apps ship for macOS and both register the `kindle` URL scheme, so
 * "open Kindle" is ambiguous on this machine:
 *
 *   com.amazon.Lassen  "Amazon Kindle" 7.x   the current rewrite
 *   com.amazon.Kindle  "Kindle" 1.x          the classic app, still installed
 *
 * The newer one is what we drive, and not only because it is newer: it is the only
 * one that keeps a queryable reading position. Its Core Data store carries
 * ZRAWCURRENTPOSITION and ZRAWERL (end reading location) per book, which is exactly
 * the pair needed to answer "recently read but unfinished". The classic app exposes
 * a content directory and nothing about progress, so with it the rung can only say
 * "you own books" and open the library.
 *
 * Nothing here writes. The store is copied before it is read, because it is live
 * WAL-mode SQLite and a reader that touches the original can block the app that
 * owns it.
 */

/**
 * What we knew last time the library could be read.
 *
 * macOS puts another application's container behind Full Disk Access, and a
 * launchd job cannot raise that prompt: the read comes back "Operation not
 * permitted", or simply blocks. Without this the rung then reports no book at all,
 * which is both wrong and unfixable-looking.
 *
 * The cache is enough to do the one thing that matters, because the ASIN is what
 * opens the book and Amazon holds the position itself. It is always labelled as
 * remembered, with the time it was read, and never presented as a live reading.
 */
export function rememberBooks(state) {
  if (!state.book) return state;
  try {
    fs.writeFileSync(
      READING_CACHE,
      JSON.stringify({ at: Date.now(), book: state.book, shelf: state.shelf ?? [] }, null, 2)
    );
  } catch {
    /* the cache is a courtesy; failing to write it must not fail the read */
  }
  return state;
}

/**
 * The last reading that was remembered, or null when there is none.
 *
 * Two very different things used to arrive here as the same `null`: a cache that was never
 * written (an ordinary first run, and nothing to report) and a cache that exists and is corrupt
 * (a truncated write, a disk that filled) which is a real fault and the reason the panel would
 * show no book at the exact moment the live read had already failed. The reading is still null in
 * both cases, because a corrupt cache genuinely has no book in it, but the fault is now handed to
 * `onFault` so the caller can say what happened instead of showing an empty shelf.
 *
 * @param {{ onFault?: (fault: {reason:string, error:string, file:string}) => void }} [opts]
 * @returns {{ at:number, book:object, shelf:object[] } | null}
 */
export function recallBooks({ onFault = null } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(READING_CACHE, 'utf8');
  } catch (err) {
    // Never written is the expected absence, and the only one that is not a fault.
    if (err.code !== 'ENOENT') {
      onFault?.({ reason: 'cache_unreadable', error: err.message, file: READING_CACHE });
    }
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    onFault?.({ reason: 'cache_corrupt', error: err.message, file: READING_CACHE });
    return null;
  }
  if (!parsed?.book) {
    // A well-formed cache holding no book. `rememberBooks` refuses to write one, so reaching this
    // means the file was edited or half-written; it is a fault, not the ordinary empty case.
    onFault?.({ reason: 'cache_has_no_book', error: 'the cache parsed but carries no book', file: READING_CACHE });
    return null;
  }
  return parsed;
}

export const KINDLE_APPS = [
  {
    generation: 'current',
    app: 'Amazon Kindle',
    bundleId: 'com.amazon.Lassen',
    container: 'Library/Containers/com.amazon.Lassen/Data',
    bookData: 'Library/Protected/BookData.sqlite',
  },
  {
    generation: 'classic',
    app: 'Kindle',
    bundleId: 'com.amazon.Kindle',
    container: 'Library/Containers/com.amazon.Kindle/Data',
    library: 'Library/Application Support/Kindle/My Kindle Content',
  },
];

/** A book is done when the position reaches the end. Kindle's own "read" flag lags. */
const FINISHED_AT = 0.97;

export function installedKindles({ home = os.homedir() } = {}) {
  return KINDLE_APPS.filter((k) => fs.existsSync(`/Applications/${k.app}.app`)).map((k) => ({
    ...k,
    hasBookData: Boolean(k.bookData && fs.existsSync(path.join(home, k.container, k.bookData))),
  }));
}

/**
 * ZBOOKID is "A:B0046LU7H0-0": a source prefix, the ASIN, and a per-account index.
 * The URL scheme wants the bare ASIN.
 */
export function asinOf(bookId) {
  if (!bookId) return null;
  const m = String(bookId).match(/([A-Z0-9]{10})/);
  return m ? m[1] : null;
}

/**
 * At most two reads of the store outstanding at once, and never one we cannot walk away from.
 *
 * A read of this path can block for minutes at the filesystem level, for every
 * process on the machine, with no error: seen here while the disk was 94% full and
 * macOS was busy with the container. Node cannot cancel a read already handed to
 * the threadpool, and the pool has four threads, so issuing another read every time
 * one is stuck ends with no asynchronous I/O left anywhere in the daemon.
 *
 * So a stuck read is abandoned rather than waited on, and a third is never started behind two
 * that are still out there.
 */
const inFlight = new Map();

/**
 * Whether to start another read of this store.
 *
 * Abandoned reads are counted per path, because "this file is not answering" says
 * nothing about any other file. Two rules, both learned the hard way: never let a
 * read that will never settle lock the rung out forever, and never let the daemon
 * pile up more of them than the threadpool can spare.
 */
export function mayReadStore(outstanding, { now = Date.now(), retryAfterMs = 30000, max = 2 } = {}) {
  if (!outstanding || outstanding.count === 0) return true;
  if (outstanding.count >= max) return false;
  return now - outstanding.startedAt >= retryAfterMs;
}

async function copyStore(dbPath, base, { timeoutMs }) {
  if (!mayReadStore(inFlight.get(dbPath))) {
    throw new Error('the book store is still answering an earlier read');
  }
  const state = inFlight.get(dbPath) ?? { count: 0, startedAt: 0 };
  state.count += 1;
  state.startedAt = Date.now();
  inFlight.set(dbPath, state);

  const done = (async () => {
    for (const part of ['', '-wal', '-shm']) {
      let bytes;
      try {
        bytes = await fs.promises.readFile(dbPath + part);
      } catch (err) {
        // The main file is the read; a missing journal file is normal.
        if (part === '') throw err;
        continue;
      }
      await fs.promises.writeFile(base + part, bytes);
    }
  })().finally(() => {
    state.count -= 1;
  });

  let timer;
  const gaveUp = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the book store did not answer in ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([done, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

async function querySqlite(dbPath, sql, { timeoutMs = 4000 } = {}) {
  // Copy first. This is a live WAL database owned by another process; the -wal file
  // holds writes that are not in the main file yet, so all three parts travel
  // together or the read silently returns stale rows.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-kindle-'));
  try {
    const base = path.join(tmp, path.basename(dbPath));
    // Read and written here, in this process. Every word of that was paid for.
    //
    // NOT `copyfile`, which is what `fs.copyFileSync` and `cp` both call: it clones
    // the extents and carries the extended attributes over, and on this store,
    // inside another app's container, that call blocks where a plain read of the
    // same bytes returns at once.
    //
    // NOT in a child process either, however killable that would make it. macOS
    // decides access to another application's container by responsible process, and
    // a spawned `sh` does not inherit ours: the child is refused where this process
    // is allowed. Proved with a launchd job, which got "Operation not permitted"
    // for a file this process reads without complaint.
    await copyStore(dbPath, base, { timeoutMs });
    const { stdout } = await run('/usr/bin/sqlite3', ['-json', '-readonly', base, sql], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const BOOK_SQL = `
  SELECT ZBOOKID AS bookId,
         ZDISPLAYTITLE AS title,
         ZRAWLASTACCESSTIME AS lastAccess,
         ZRAWCURRENTPOSITION AS position,
         ZRAWMAXPOSITION AS maxPosition,
         ZRAWERL AS erl,
         ZRAWREADSTATE AS readState,
         ZRAWISUNREAD AS unread
  FROM ZBOOK
  WHERE ZRAWCURRENTPOSITION > 0
  ORDER BY ZRAWLASTACCESSTIME DESC
  LIMIT 40;
`;

export function describeBook(row) {
  // ERL is the end reading location and is -1 for books never opened on this device.
  // Max position is the furthest byte the app knows about, which is the better
  // denominator when ERL is absent.
  const end = row.erl > 0 ? row.erl : row.maxPosition > 0 ? row.maxPosition : 0;
  const progress = end > 0 ? Math.min(1, row.position / end) : null;
  return {
    bookId: row.bookId,
    asin: asinOf(row.bookId),
    title: row.title || 'Untitled',
    position: row.position,
    end,
    progress,
    percent: progress === null ? null : Math.round(progress * 100),
    lastAccess: row.lastAccess ? row.lastAccess * 1000 : null,
    finished: progress !== null && progress >= FINISHED_AT,
  };
}

/**
 * One book to open, and the rest of what you have going behind it.
 *
 * The rung opens the first one without asking, so the order matters more than it
 * looks: the shelf exists to be gone looking for, never to be handed to you at the
 * moment the gap opens. A book with no ASIN cannot be addressed in the reader, so it
 * cannot be either.
 */
export function pickBooks(books, { max = 12 } = {}) {
  const readable = books.filter((b) => !b.finished && b.asin);
  return { book: readable[0] ?? null, shelf: readable.slice(1, max) };
}

/**
 * The book to go back to: most recently opened, actually started, not finished.
 *
 * "Recently read" has to mean recently *read*, not recently touched. A book you
 * opened and bounced off has a position of zero, and routing you back into it is
 * the same as routing you into an empty deck, so those are filtered out in SQL.
 */
export async function kindleState(config = {}, { home = os.homedir() } = {}) {
  const preferred = config.reading?.app ?? 'Amazon Kindle';
  // Only a reading of the real library is ever remembered or recalled. A test
  // fixture is a made up library, and one of those in the cache would come back
  // later as a book you never opened, presented as the book you were reading.
  const real = home === os.homedir();
  const installed = installedKindles({ home });
  if (installed.length === 0) {
    return { available: false, reason: 'app_not_installed', app: preferred, book: null };
  }

  // Prefer the app that can answer "where was I", then the operator's choice.
  const target =
    installed.find((k) => k.hasBookData) ??
    installed.find((k) => k.app === preferred) ??
    installed[0];

  if (!target.hasBookData) {
    const lib = target.library ? path.join(home, target.container, target.library) : null;
    const hasBooks = lib ? fs.existsSync(lib) : false;
    return {
      available: true,
      reason: hasBooks ? 'library_found_no_positions' : 'installed',
      app: target.app,
      bundleId: target.bundleId,
      generation: target.generation,
      book: null,
    };
  }

  let rows = [];
  try {
    rows = await querySqlite(path.join(home, target.container, target.bookData), BOOK_SQL);
  } catch (err) {
    // A store we cannot read is a visibility problem, not evidence of no books.
    // Refusing to open an installed reader would be the more annoying failure.
    // The fallback to the remembered reading is itself allowed to fail, and when it does the
    // panel would otherwise show "no book" twice over with one cause named and one invisible.
    let cacheFault = null;
    const remembered = real ? recallBooks({ onFault: (f) => { cacheFault = f; } }) : null;
    const denied = /not permitted|EPERM|ETIMEDOUT|timed out|killed/i.test(err.message);
    return {
      available: true,
      reason: denied ? 'book_data_forbidden' : `book_data_unreadable: ${err.message}`,
      detail: err.message.split('\n')[0],
      app: target.app,
      bundleId: target.bundleId,
      generation: target.generation,
      book: remembered?.book ?? null,
      shelf: remembered?.shelf ?? [],
      // Never passed off as a live reading. The panel says when it was taken.
      stale: Boolean(remembered),
      staleSince: remembered?.at ?? null,
      // Null on the ordinary first run, where there simply is nothing remembered yet. Set only
      // when the cache exists and could not be used, which is a second failure on top of the
      // refusal above and used to look identical to it.
      cacheFault,
    };
  }

  const { book, shelf } = pickBooks(rows.map(describeBook));
  const live = { book, shelf };

  const answer = {
    available: true,
    reason: book ? 'book_in_progress' : 'no_unfinished_book',
    app: target.app,
    bundleId: target.bundleId,
    generation: target.generation,
    ...live,
    stale: false,
    staleSince: null,
    started: rows.length,
  };
  return real ? rememberBooks(answer) : answer;
}

/**
 * Open the reader at the book, addressed by ASIN through the URL scheme.
 *
 * `open -b` targets the bundle id rather than the name, which matters here: both
 * Kindle apps claim `kindle://`, so an untargeted open is a coin flip decided by
 * Launch Services, and the classic app would land you in the wrong library.
 *
 * The scheme is best effort by nature; if it is refused we still raise the reader,
 * which resumes wherever you were. Either way you land in the book, and the panel
 * shows the position we resolved so the two can be compared.
 */
export async function openBook(state, { timeoutMs = 6000 } = {}) {
  const bundleId = state.bundleId ?? 'com.amazon.Lassen';
  const detail = { app: state.app, bundleId, asin: state.book?.asin ?? null };

  if (state.book?.asin) {
    try {
      await run(
        '/usr/bin/open',
        ['-b', bundleId, `kindle://book?action=open&asin=${state.book.asin}`],
        { timeout: timeoutMs }
      );
      detail.via = 'url-scheme';
      return detail;
    } catch (err) {
      detail.urlSchemeError = err.message;
    }
  }

  await run('/usr/bin/open', ['-b', bundleId], { timeout: timeoutMs });
  detail.via = 'activate';
  return detail;
}
