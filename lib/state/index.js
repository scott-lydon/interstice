import { dueCount } from './anki.js';
import { idleMs, frontmostApp } from './system.js';
import { kindleState } from './kindle.js';
import { scrapeTodoLists } from './notes.js';
import { applyOverrides, openCount } from '../todo-store.js';

/**
 * Gather everything the router needs, concurrently and with a hard ceiling.
 *
 * A provider that misbehaves reports `null` rather than throwing, and the router
 * treats null as "unavailable" (rung ineligible) rather than as zero. The
 * difference matters: an unreachable Anki must not look like an empty deck.
 */

/**
 * Notes and the Kindle store are slower than the rest and change on the scale of
 * hours, so they are cached. Without this every threshold evaluation would pay for
 * an Apple event round trip and a database copy, and the router has under a second
 * to decide.
 */
const cache = new Map();

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidate(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function readingSnapshot(config) {
  return cached('reading', config.reading?.cacheMs ?? 60000, () => kindleState(config));
}

export async function todoSnapshot(config) {
  const lists = await cached('todo', config.todo?.cacheMs ?? 120000, () => scrapeTodoLists(config));
  // Overrides are read fresh every time. They change the instant you tick a box,
  // and a stale copy would leave a finished list looking like work.
  return { ...lists, lists: applyOverrides(lists.lists) };
}

export async function snapshot(config, { now = Date.now(), overrides = {} } = {}) {
  const withTimeout = (promise, ms, fallback) =>
    Promise.race([
      promise.catch(() => fallback),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms).unref?.()),
    ]);

  const budget = 1500;
  const [ankiDue, idle, front, reading, todos] = await Promise.all([
    withTimeout(dueCount(config), budget, null),
    withTimeout(idleMs(), budget, null),
    withTimeout(frontmostApp(), budget, null),
    withTimeout(readingSnapshot(config), budget, null),
    withTimeout(todoSnapshot(config), budget, null),
  ]);

  return {
    now,
    ankiDue,
    idleMs: idle,
    frontmostApp: front,
    // The reading rung exists to put a specific book in front of you, so "is a
    // reader installed" is not enough: without a book in progress there is nothing
    // to deliver, and a rung with nothing in it must fall through.
    bookInProgress: reading === null ? null : Boolean(reading.available && reading.book),
    book: reading?.book ?? null,
    todoAvailable: todos === null ? null : todos.available && openCount(todos.lists) > 0,
    todoOpen: todos ? openCount(todos.lists) : null,
    ...overrides,
  };
}
