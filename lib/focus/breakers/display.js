// Breaker: display sleep or screen lock forfeits the focus block. Reading a book without
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

/** The pure decision: a locked or asleep display is a break. */
export function decideLock({ locked, at }) {
  if (!locked) return null;
  return { cause: 'lock', at, detail: 'the display slept or the screen locked' };
}

/**
 * Whether the screen is locked right now, via ioreg IOConsoleLocked. Returns false on any probe
 * failure rather than throwing: a probe that cannot answer must not itself forfeit a block.
 */
export async function screenLocked({ timeoutMs = 1500 } = {}) {
  try {
    const { stdout } = await run('/bin/sh', ['-c',
      "/usr/sbin/ioreg -n Root -d1 -a | /usr/bin/plutil -extract IOConsoleLocked raw - 2>/dev/null"],
      { timeout: timeoutMs });
    return String(stdout).trim() === 'true';
  } catch {
    return false;
  }
}

/** The breaker, with the shared three-function interface; `locked` is injectable for tests. */
export function createDisplayBreaker({ locked = screenLocked } = {}) {
  return {
    name: () => 'display-lock',
    describe: () => 'breaks a block when the display sleeps or the screen locks (ioreg IOConsoleLocked)',
    async probe(nowISO = new Date().toISOString()) {
      return decideLock({ locked: await locked(), at: nowISO });
    },
  };
}
