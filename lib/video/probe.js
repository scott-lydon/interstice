// The video probe (4.1). Reports currently-playing online video as plain
// { browser, url, host, playing } records. Browsers only (S3): it reads each page's real media
// play state, not merely whether a tab is open. It is strictly read-only (4.2): it lists targets
// and evaluates a read-only expression, and never navigates, activates, or creates a tab, honouring
// the project's "nothing is ever quit, hidden, or closed" rule.

// The read-only expression run in each page: true iff some media element is actually playing.
export const PLAYING_EXPRESSION =
  '[...document.querySelectorAll("video,audio")].some(m => !m.paused && !m.ended && m.readyState > 2 && m.currentTime > 0)';

/**
 * The host of a URL, or a named failure.
 *
 * It used to answer `''` for anything it could not parse, which is the one answer that is wrong in
 * two directions at once: `''` is a host, so it flowed into the whitelist check and into the video
 * breaker's debounce as though it were one, and every unparseable URL in the browser shared it, so
 * two different unnameable tabs debounced each other as if they were the same source.
 *
 * @returns {{ host: string, error: null } | { host: null, error: string }}
 */
function hostOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (err) {
    return { host: null, error: err.message };
  }
  // `new URL('http://')` throws, but `new URL('http://#x')` does not and yields an empty hostname.
  // A URL with no host in it is not a source we can name either.
  if (!host) return { host: null, error: `no host in ${JSON.stringify(url)}` };
  return { host, error: null };
}

/**
 * Pure: turn raw {browser,url,playing} rows into full records with a host.
 *
 * A row whose URL will not parse is kept rather than dropped, with `host: null` and the reason in
 * `hostError`. Kept, because a video playing at a URL we cannot name must still be able to break a
 * block: whitelist.js settles that a source we cannot name is a source we cannot trust to be
 * whitelisted, and silently dropping the row would have made it whitelisted by disappearance.
 */
export function toVideoRecords(rows) {
  return rows
    .filter((r) => r && r.url && /^https?:/.test(r.url))
    .map((r) => {
      const { host, error } = hostOf(r.url);
      return { browser: r.browser, url: r.url, host, hostError: error, playing: !!r.playing };
    });
}

/**
 * Probe every provided browser endpoint for playing video. `connect` is injectable so a test drives
 * it with a fixture and no live browser. Returns [] when no endpoint is reachable, launching nothing.
 * @param {{ browsers?: Array<{name:string, wsUrl:string, readerProfile?:boolean}>, connect: Function }} opts
 */
export async function probeVideo({ browsers = [], connect }) {
  const rows = [];
  for (const b of browsers) {
    let session;
    try {
      session = await connect(b.wsUrl);
    } catch {
      continue; // an unreachable browser is not an error; it is simply no video
    }
    try {
      const { targetInfos = [] } = (await session.send('Target.getTargets')) || {};
      for (const t of targetInfos) {
        if (t.type !== 'page' || !/^https?:/.test(t.url || '')) continue;
        let playing = false;
        try {
          const res = await session.send('Runtime.evaluate', {
            expression: PLAYING_EXPRESSION,
            returnByValue: true,
          }, t.sessionId);
          playing = !!res?.result?.value;
        } catch {
          playing = false;
        }
        rows.push({ browser: b.name, url: t.url, playing, readerProfile: !!b.readerProfile });
      }
    } finally {
      session.close?.();
    }
  }
  // preserve the readerProfile flag through the pure mapper
  return toVideoRecords(rows).map((rec, i) => ({ ...rec, readerProfile: rows[i]?.readerProfile ?? false }));
}
