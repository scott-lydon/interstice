import { dueCount } from './anki.js';
import { idleMs, frontmostApp, isRunning } from './system.js';

/**
 * Gather everything the router needs, concurrently and with a hard ceiling.
 *
 * A provider that misbehaves reports `null` rather than throwing, and the router
 * treats null as "unavailable" (rung ineligible) rather than as zero. The
 * difference matters: an unreachable Anki must not look like an empty deck.
 */
export async function snapshot(config, { now = Date.now(), overrides = {} } = {}) {
  const withTimeout = (promise, ms, fallback) =>
    Promise.race([
      promise.catch(() => fallback),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms).unref?.()),
    ]);

  const budget = 1500;
  const [ankiDue, idle, front, kindleRunning] = await Promise.all([
    withTimeout(dueCount(config), budget, null),
    withTimeout(idleMs(), budget, null),
    withTimeout(frontmostApp(), budget, null),
    withTimeout(isRunning(config.reading.app), budget, false),
  ]);

  return {
    now,
    ankiDue,
    idleMs: idle,
    frontmostApp: front,
    bookInProgress: kindleRunning,
    todoAvailable: true,
    ...overrides,
  };
}
