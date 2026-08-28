// Breaker: the screen locking forfeits the focus block. Reading a book without
// touching the keyboard is focus, not absence, so this breaker keys on the session locking,
// never on idle. The signal is `IOConsoleLocked`, so a display that sleeps without locking,
// which depends on the machine's "require password after" setting, is not seen.
//
// The lock probe is `ioreg` reading IOConsoleLocked, which needs no native module and no grant
// (the project's no-runtime-dependency, no-extra-permission stance). It is a poll rather than an event,
// so a lock and unlock inside one tick interval is invisible to it. The pure decision is separated
// from the probe so a test drives it with an injected lock state and no live machine.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The pure decision: a locked console is a break. */
export function decideLock({ locked, at }) {
  if (!locked) return null;
  return { cause: 'lock', at, detail: 'the screen locked' };
}

/**
 * Whether the screen is locked right now, via ioreg IOConsoleLocked. Returns false on any probe
 * failure rather than throwing: a probe that cannot answer must not itself forfeit a block.
 */
export async function screenLocked({ timeoutMs = 1500 } = {}) {
  try {
    return await screenLockedStrict({ timeoutMs });
  } catch {
    return false;
  }
}

/**
 * The same probe, but it throws when it cannot answer.
 *
 * The breaker must never throw, because a broken sensor forfeiting a block is worse than a
 * missed break. But `doctor` needs the opposite: a check named "the screen-lock signal is
 * readable" that can only ever see `false` prints a green tick for a signal it never reached,
 * which is the exact defect the video probe check was fixed for. So the swallow lives in the
 * breaker's wrapper above, and doctor calls this.
 */
export async function screenLockedStrict({ timeoutMs = 1500 } = {}) {
  const { stdout } = await run('/bin/sh', ['-c',
    "/usr/sbin/ioreg -n Root -d1 -a | /usr/bin/plutil -extract IOConsoleLocked raw -"],
    { timeout: timeoutMs });
  const out = String(stdout).trim();
  if (out !== 'true' && out !== 'false') {
    throw new Error(
      `IOConsoleLocked read back ${JSON.stringify(out)}, which is not a boolean. `
      + 'Remedy: check that /usr/sbin/ioreg and /usr/bin/plutil are both present and on PATH.'
    );
  }
  return out === 'true';
}

/** The breaker, with the shared three-function interface; `locked` is injectable for tests. */
export function createDisplayBreaker({ locked = screenLocked } = {}) {
  return {
    name: () => 'display-lock',
    describe: () =>
      'breaks a block when the screen locks (ioreg IOConsoleLocked); '
      + 'a display that sleeps without locking is not seen',
    async probe(nowISO = new Date().toISOString()) {
      return decideLock({ locked: await locked(), at: nowISO });
    },
  };
}
