// Breaker: non-whitelisted online video playing forfeits the focus block (S2c). Browsers only,
// tab URL plus play state. The Interstice reader profile never breaks its own block, so
// records from it are ignored. Playback shorter than `breakAfterMs` is a flicker, not a
// distraction, and is debounced away.

import { isWhitelisted } from '../../video/whitelist.js';

/**
 * The pure decision over a set of probe records. Returns the first offending record (playing, not
 * whitelisted, not from the reader profile), or null.
 * A record is { browser, url, host, playing, readerProfile? }.
 */
export function decideVideo(records, { whitelist = [] } = {}) {
  for (const r of records) {
    if (!r.playing) continue;
    if (r.readerProfile) continue; // S4: the reader's own profile never breaks
    let allowed;
    try {
      allowed = isWhitelisted(r.url, whitelist);
    } catch {
      // An unparseable source is not whitelisted (whitelist.js: a source we cannot name is a source
      // we cannot trust). The reason is not lost: the probe records it on the row as `hostError`.
      allowed = false;
    }
    if (!allowed) return r;
  }
  return null;
}

/**
 * The breaker, with debounce. It holds the time non-whitelisted playback was first seen; a break is
 * emitted only once that playback has been continuous for `breakAfterMs`. Any tick with no
 * offending playback resets the timer, so a one-frame autoplay costs nothing.
 */
export function createVideoBreaker({ whitelist = [], breakAfterMs, probe } = {}) {
  // Required, for the same reason `blockMinutes` is: the shipped 4000 lives in
  // config/interstice.config.default.json and a copy of it here was a second number to keep in step.
  if (!Number.isFinite(breakAfterMs) || breakAfterMs < 0) {
    throw new Error(
      `createVideoBreaker needs breakAfterMs as a number of milliseconds, got ${JSON.stringify(breakAfterMs)}. ` +
        'Remedy: pass config.focus.videoBreakAfterMs, whose shipped value is in config/interstice.config.default.json.'
    );
  }
  let offendingSince = null;
  let offendingHost = null;
  return {
    name: () => 'video',
    describe: () => `breaks a block after ${breakAfterMs}ms of non-whitelisted video playback`,
    async probe(nowISO = new Date().toISOString()) {
      const records = probe ? await probe() : [];
      const hit = decideVideo(records, { whitelist });
      if (!hit) {
        offendingSince = null;
        offendingHost = null;
        return null;
      }
      const now = Date.parse(nowISO);
      // Identified by host, falling back to the whole URL when the probe could not name a host
      // (`hostError` is set). Two different unnameable sources must not debounce each other into
      // one, which is what happened while an unparseable URL reported its host as the empty string.
      const identity = hit.host ?? hit.url;
      if (offendingSince === null || identity !== offendingHost) {
        // Newly-offending host: start (or restart) its debounce clock from this instant.
        offendingSince = now;
        offendingHost = identity;
      }
      if (now - offendingSince >= breakAfterMs) {
        offendingSince = null;
        offendingHost = null;
        // `host: null` is reported as itself with the URL beside it, rather than as a blank the
        // forfeit banner would render as a break with no source.
        return { cause: 'video', at: nowISO, detail: { host: hit.host, url: hit.host ? undefined : hit.url } };
      }
      return null; // still within the debounce window
    },
  };
}
