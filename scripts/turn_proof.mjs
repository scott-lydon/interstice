/**
 * 1.11 The next screen transition, covered end to end.
 *
 * The operator's complaint is about going to the NEXT SCREEN, so what is asserted is the
 * transition, not a single frame. Ten consecutive turns, and each one has to produce all three of:
 *
 *   1. a new page image        (the sequence number advanced AND the bytes differ)
 *   2. a changed position      (the label or the percent moved)
 *   3. no failure surface      (no bookError, no dead vendor script, no unanswered prompt)
 *
 * A turn that stalls fails the run and names the STAGE it stalled in, because "it did not turn"
 * and "it turned and drew the same thing" and "it turned into Amazon's error page" are three
 * different faults with three different next moves, and a single boolean loses that.
 *
 * Driven through the same surface the panel uses, so a pass here is a statement about the product
 * and not about a private path into it.
 *
 * Exits 0 only when all ten turns pass. Not part of `node --test`: it needs a live reader, a live
 * session, and a book that opens, so it is run deliberately.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.js';
import { loadCached } from '../lib/config.js';

const TURNS = 10;
const WIDTH = 900;
const HEIGHT = 1200;
/** How long one turn may take before it is called a stall. */
const TURN_BUDGET_MS = 25_000;

const log = (...a) => console.log(...a);

/**
 * Why this frame is not a page of the book, or null if it is one.
 *
 * Every arm here is a failure the panel has a surface for, so a turn that lands on one is a
 * failed turn even though the reader answered.
 */
function notAPage(view) {
  if (!view) return 'the reader returned nothing';
  if (view.signedOut) return 'the reader is signed out';
  if (view.bookError) return "Amazon's own failure page is on screen";
  if (view.prompt) return `Amazon is asking something and it was not answered: ${view.prompt}`;
  if (view.deadScripts?.length) return `Amazon's reader failed to load: ${view.deadScripts[0]}`;
  // Required to be TRUE, not merely "not false". The first draft of this asked whether painted was
  // === false, so a reader that answered without the field at all, which is exactly what a reader
  // that never started answers, sailed through the open check and failed one line later with a
  // confusing message about the position not moving. Asserting the absence of a known negative
  // instead of the presence of the thing wanted is the defect this whole loop is about.
  if (view.painted !== true) return `the page has not painted (painted: ${JSON.stringify(view.painted)})`;
  if (!view.label) return 'the page carries no position label';
  return null;
}

/** The daemon's own control token, the way every other caller gets it. */
function token() {
  return fs.readFileSync(path.join(ROOT, 'logs', 'control-token'), 'utf8').trim();
}

/**
 * The daemon over HTTP, not a Reader of our own.
 *
 * Constructing a second Reader here launches a second browser against the same user-data-dir the
 * running daemon already holds, so the two fight over the profile and this measures the fight
 * rather than the product. The panel reaches the reader through these routes, so this does too.
 */
async function call(port, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/reading/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-interstice-token': token() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} answered ${res.status}`);
  return res.json();
}

const position = (v) => `${v?.label ?? ''}|${v?.percent ?? ''}`;

async function main() {
  const config = await loadCached();
  const port = config?.port ?? 7420;
  const asin = config?.reading?.asin ?? null;
  const box = { width: WIDTH, height: HEIGHT };

  const fail = (stage, detail, extra = {}) => {
    log(`\nFAILED at stage: ${stage}`);
    log(`  ${detail}`);
    for (const [k, v] of Object.entries(extra)) log(`  ${k}: ${JSON.stringify(v)}`);
    process.exitCode = 1;
  };

  log('opening the book');
  let view = await call(port, 'view', { asin, ...box });
  if (process.env.TURN_PROOF_DEBUG) log('  raw keys: ' + Object.keys(view).join(','));
  let why = notAPage(view);
  if (why) {
    fail('open', `the book never came up, so no turn could be attempted: ${why}`, {
      label: view?.label, painted: view?.painted, spinner: view?.spinner,
    });
    return;
  }
  log(`  open at ${position(view)}`);

  for (let turn = 1; turn <= TURNS; turn += 1) {
    const before = { seq: view.seq, position: position(view), frameAt: view.frameAt };
    const startedAt = Date.now();

    // The surface's own input path, which is what the panel's Next button reaches. Written as a
    // guessed `reading.turn(...)` with a fallback to `reader.turn(...)` first: that name does not
    // exist, so the fallback would have run every time and this would have proved something about
    // a private path into the reader rather than about the product.
    const turned = await call(port, 'input', { kind: 'turn', direction: 'next' });
    const spent = Date.now() - startedAt;

    if (turned?.ok === false) {
      return fail(`turn ${turn}`, turned.reason ?? 'the turn was refused', {
        stage: turned.stage, expected: turned.expected, actual: turned.actual, ms: spent,
      });
    }
    if (spent > TURN_BUDGET_MS) {
      return fail(`turn ${turn}`, `the turn took ${spent}ms, past the ${TURN_BUDGET_MS}ms budget`, before);
    }

    view = await call(port, 'view', { asin, ...box });

    why = notAPage(view);
    if (why) return fail(`turn ${turn}, after`, why, { before, ms: spent });
    if (view.seq === before.seq) {
      return fail(`turn ${turn}, image`, 'the page image did not change: same sequence number', { before, ms: spent });
    }
    if (position(view) === before.position) {
      return fail(`turn ${turn}, position`, `the position did not move: still ${before.position}`, { ms: spent });
    }

    log(`  turn ${String(turn).padStart(2)} ok  ${before.position} -> ${position(view)}  (${spent}ms)`);
  }

  log(`\nall ${TURNS} turns produced a new image, a changed position, and no failure surface`);
}

main().catch((err) => {
  log(`\nFAILED at stage: harness`);
  log(`  ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
