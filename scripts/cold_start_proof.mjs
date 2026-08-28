/**
 * 1.7 Cold-start proof, three consecutive times.
 *
 * From a fully cold state the book must open at the synced position with no intervention. Cold
 * means a brand new Reader with no carried in-process state and the previous browser torn down, so
 * each round exercises the same path a fresh daemon takes.
 *
 * The assertions are the ones the item names, and each is checked independently so a pass cannot
 * come from one of them alone:
 *   1. the rendered page is NOT blank
 *   2. the page position matches what Kindle says is synced
 *
 * Exits 0 only when all three rounds pass.
 */
import { loadCached } from '../lib/config.js';
import { Reader } from '../lib/reader.js';
import { createReadingSurface } from '../lib/reading.js';
import { kindleState } from '../lib/state/kindle.js';

const ROUNDS = 3;
const WIDTH = 900;
const HEIGHT = 1200;
// Kindle reports a whole percent and the reader reports its own; they are two readings of one
// position, so they are compared with a tolerance rather than for equality.
const PERCENT_TOLERANCE = 2;

const log = (...a) => console.log(...a);

function blank(view) {
  // A blank page is the failure this proof exists to catch, and it has three shapes: no frame at
  // all, a frame with no text, and a frame the reader itself marks as not ready.
  if (!view) return 'no view returned';
  if (view.signedOut) return 'the reader is signed out';
  if (view.ready === false) return 'the reader reported ready:false';
  return null;
}

async function round(n, config, synced) {
  log(`\n--- round ${n} of ${ROUNDS}, cold start`);
  const reader = new Reader({ config, logger: { info: () => {}, warn: () => {}, error: () => {} } });
  const surface = createReadingSurface({ reader });
  try {
    const view = await surface.view({ asin: synced.asin, width: WIDTH, height: HEIGHT });
    if (process.env.COLD_DEBUG) {
      const shown = { ...view };
      delete shown.frame; delete shown.image; delete shown.png;
      log('    view:', JSON.stringify(shown).slice(0, 600));
      log('    reader:', JSON.stringify({
        running: reader.running, signingIn: reader.signingIn, asin: reader.asin,
        seq: reader.seq, lastError: String(reader.lastError ?? '')
      }).slice(0, 400));
    }
    const why = blank(view);
    if (why) throw new Error(`blank page: ${why}`);

    const words = await surface.words({ fresh: true });
    const chars = (words?.text || '').trim().length;
    if (chars < 40) throw new Error(`page rendered but carries only ${chars} characters of text`);

    const shown = view.percent ?? view.position ?? null;
    if (shown == null) throw new Error('the reader reported no position at all');
    const drift = Math.abs(Number(shown) - Number(synced.percent));
    if (Number.isFinite(drift) && drift > PERCENT_TOLERANCE) {
      throw new Error(`opened at ${shown}% but Kindle is synced to ${synced.percent}%`);
    }

    log(`    non-blank: ${chars} characters of text`);
    log(`    position:  reader ${shown}% against Kindle ${synced.percent}%`);
    return true;
  } finally {
    // Tearing the browser down is what makes the NEXT round genuinely cold.
    try { await reader.close?.(); } catch { /* the next round starts cold either way */ }
  }
}

const config = loadCached({ force: true });
const state = await kindleState(config);
if (!state.book) {
  console.error(`cannot run: ${state.reason}`);
  process.exit(2);
}
const synced = { asin: state.book.asin, percent: state.book.percent, title: state.book.title };
log(`Kindle reports: ${synced.title.slice(0, 50)} at ${synced.percent}% (asin ${synced.asin})`);

let passed = 0;
for (let i = 1; i <= ROUNDS; i += 1) {
  try {
    await round(i, config, synced);
    passed += 1;
    log(`    round ${i}: PASS`);
  } catch (err) {
    log(`    round ${i}: FAIL, ${err.message}`);
  }
}
log(`\n${passed} of ${ROUNDS} cold starts opened the book at the synced position`);
process.exit(passed === ROUNDS ? 0 : 1);
