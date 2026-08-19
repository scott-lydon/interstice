// Breaker: non-whitelisted online video playing forfeits the focus block (S2c). Browsers only,
// tab URL plus play state (S3). The Interstice reader profile never breaks its own block (S4), so
// records from it are ignored. Playback shorter than `breakAfterMs` is a flicker, not a
// distraction, and is debounced away (4.5).

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
      allowed = false; // an unparseable source is not whitelisted; the probe error is logged upstream
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
export function createVideoBreaker({ whitelist = [], breakAfterMs = 4000, probe } = {}) {
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
      if (offendingSince === null || hit.host !== offendingHost) {
        // Newly-offending host: start (or restart) its debounce clock from this instant.
        offendingSince = now;
        offendingHost = hit.host;
      }
      if (now - offendingSince >= breakAfterMs) {
        offendingSince = null;
        offendingHost = null;
        return { cause: 'video', at: nowISO, detail: { host: hit.host } };
      }
      return null; // still within the debounce window
    },
  };
}
