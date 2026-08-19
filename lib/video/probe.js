// The video probe (4.1). Reports currently-playing online video as plain
// { browser, url, host, playing } records. Browsers only (S3): it reads each page's real media
// play state, not merely whether a tab is open. It is strictly read-only (4.2): it lists targets
// and evaluates a read-only expression, and never navigates, activates, or creates a tab, honouring
// the project's "nothing is ever quit, hidden, or closed" rule.

// The read-only expression run in each page: true iff some media element is actually playing.
export const PLAYING_EXPRESSION =
  '[...document.querySelectorAll("video,audio")].some(m => !m.paused && !m.ended && m.readyState > 2 && m.currentTime > 0)';

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** Pure: turn raw {browser,url,playing} rows into full records with a host. */
export function toVideoRecords(rows) {
  return rows
    .filter((r) => r && r.url && /^https?:/.test(r.url))
    .map((r) => ({ browser: r.browser, url: r.url, host: hostOf(r.url), playing: !!r.playing }));
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
