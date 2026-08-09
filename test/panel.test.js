import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { screenFrame, placeBottomRight, Panel, readPanelPid } from '../lib/panel.js';
import { ROOT, PANEL_PID } from '../lib/paths.js';

/**
 * The window has to land in the bottom right corner of the *usable* screen, which
 * is not the same as the screen. Getting this wrong is invisible in code review and
 * obvious the first time the panel opens behind the Dock.
 */

const MACBOOK_AIR = {
  // Measured on this host: 1470x956 points, 44pt Dock, 33pt menu bar.
  width: 1470, height: 956, top: 33, bottom: 912, left: 0, right: 1470,
};

test('the panel sits above the Dock, not behind it', () => {
  const box = placeBottomRight(MACBOOK_AIR, { width: 440, height: 620, margin: 24 });
  assert.equal(box.x, 1470 - 440 - 24);
  assert.equal(box.y, 912 - 620 - 24);
  assert.ok(box.y + box.height <= MACBOOK_AIR.bottom, 'bottom edge clears the Dock');
  assert.ok(box.x + box.width <= MACBOOK_AIR.right, 'right edge is on screen');
  assert.ok(box.y >= MACBOOK_AIR.top, 'top edge clears the menu bar');
});

test('a panel larger than the screen is shrunk rather than pushed off it', () => {
  const small = { width: 800, height: 600, top: 25, bottom: 560, left: 0, right: 800 };
  const box = placeBottomRight(small, { width: 440, height: 620, margin: 24 });
  assert.ok(box.height <= 560 - 25 - 48, 'height fits the usable band');
  assert.ok(box.y >= small.top, 'never placed under the menu bar');
});

test('screen geometry is read from AppKit and converted to a top-left origin', async () => {
  // AppKit measures from the bottom left. If visibleFrame.origin.y were used as
  // "distance from the top", every panel would open under the menu bar.
  const f = await screenFrame();
  assert.ok(f.width > 0 && f.height > 0);
  assert.ok(f.top >= 0, 'menu bar inset is non-negative');
  assert.ok(f.bottom <= f.height, 'usable bottom is inside the screen');
  assert.ok(f.bottom > f.top, 'there is a usable band between the two');
});

test('a live panel is not replaced by a second window', async () => {
  const panel = new Panel({ config: { port: 7420, panel: { raiseOnDeliver: false } } });
  panel.ping();
  assert.equal(panel.isAlive(), true);
  const result = await panel.show('todo');
  assert.equal(result.opened, null, 'no browser was spawned over the open window');
  assert.equal(panel.state().rung, 'todo', 'the open window was told to switch instead');
});

test('two deliveries at once look for the window once, so only one can be opened', async () => {
  // The gap this closes is between the check and the open. A panel that has not
  // pinged yet reads as absent, so a second delivery arriving in that moment used
  // to run the same check, get the same answer, and open a window of its own. They
  // share a browser profile, so the second does not fail; it lands as a second
  // window in the same Chrome, which is how you end up looking at two Interstices.
  //
  // The lookup is stubbed to report a window that already exists, which keeps a
  // real browser out of the test while leaving the serialization itself under test.
  // One lookup for two concurrent deliveries is the whole guarantee: the decision
  // to open is made once, so it cannot be made twice.
  const panel = new Panel({ config: { port: 7420, panel: { raiseOnDeliver: false } } });
  panel.raise = async () => ({ raised: false });

  let looks = 0;
  panel.existingWindowPid = async () => {
    looks += 1;
    await new Promise((r) => setTimeout(r, 30)); // a real `ps` is not instant
    // The page behind that pid is showing something, which is what makes it a
    // window worth adopting rather than a process worth replacing.
    panel.ping();
    return 4242;
  };

  const had = fs.existsSync(PANEL_PID) ? fs.readFileSync(PANEL_PID) : null;
  try {
    const [a, b] = await Promise.all([panel.show('todo'), panel.show('todo')]);
    assert.equal(looks, 1, 'the second delivery joined the first attempt instead of starting its own');
    assert.equal(a.opened, null, 'the existing window was adopted, not replaced');
    assert.equal(b.opened, null, 'the existing window was adopted, not replaced');
    assert.equal(panel.pid, 4242, 'both deliveries point at the same window');
  } finally {
    if (had === null) fs.rmSync(PANEL_PID, { force: true });
    else fs.writeFileSync(PANEL_PID, had);
  }

  // And the attempt is not cached past its usefulness: a later delivery, once the
  // window has gone, is free to look again.
  assert.equal(panel.ensuring, null, 'the in-flight attempt is cleared when it settles');
});

test('a process with no page behind it is not mistaken for the window', async () => {
  // Found on this machine: a panel Chrome alive since Wednesday, our `--app` flag
  // still on its command line, `lastPingAt` still zero, nothing on screen. Adopting
  // it made every delivery report success and show the operator nothing, which is
  // worse than opening a second window because there is no error to go looking for.
  const panel = new Panel({ config: { port: 7420, panel: { raiseOnDeliver: false } } });

  // The page never pings, so the grace period expires and the husk is rejected.
  const t0 = Date.now();
  assert.equal(
    await panel.answersTo(4242, { graceMs: 600, pollMs: 100 }),
    false,
    'silence for the whole grace period means there is no page behind the process'
  );
  assert.ok(Date.now() - t0 >= 600, 'it waits the grace period out rather than giving up at once');

  // A page that is showing settles it at once, with no waiting at all.
  panel.ping();
  const t1 = Date.now();
  assert.equal(await panel.answersTo(4242, { graceMs: 600, pollMs: 100 }), true);
  assert.ok(Date.now() - t1 < 100, 'a live page is not made to wait');
});

/**
 * These two write to the pid file the running daemon is using, so whatever was
 * there is put back. Deleting it leaves a live daemon unable to raise a window that
 * is still on screen: the next rung then lands behind your editor, which is exactly
 * the symptom these tests exist to prevent.
 */
function borrowPidFile(run) {
  const had = fs.existsSync(PANEL_PID) ? fs.readFileSync(PANEL_PID) : null;
  try {
    run();
  } finally {
    if (had === null) fs.rmSync(PANEL_PID, { force: true });
    else fs.writeFileSync(PANEL_PID, had);
  }
}

test('a restarted daemon can still raise the window it inherited', () => {
  // The panel outlives the daemon on purpose: restarting Interstice must not close
  // a window you are reading. But a daemon that forgot the pid stops raising it,
  // and a rung that delivers behind your editor looks exactly like a broken rung.
  borrowPidFile(() => {
    fs.writeFileSync(PANEL_PID, String(process.pid));
    assert.equal(readPanelPid(), process.pid);
    assert.equal(new Panel({ config: { port: 7420 } }).pid, process.pid);
  });
});

test('a pid whose process is gone is not treated as a live panel', () => {
  borrowPidFile(() => {
    fs.writeFileSync(PANEL_PID, '999999');
    assert.equal(readPanelPid(), null);
  });
});

test('every rung the router can pick has a view in the panel', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  for (const rung of ['flashcards', 'reading', 'queue_prompt', 'todo']) {
    assert.ok(html.includes(`id="view-${rung}"`), `panel.html has no view for "${rung}"`);
  }
});

test('the panel raises itself by process id, never by application name', () => {
  // The panel runs the same browser binary the user browses with. Raising it by
  // name would raise their ordinary browser window instead: the wrong window, and
  // exactly the unasked-for app switch this design removes.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'panel.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  const raises = code.filter((l) => /frontmost|activate/.test(l));
  assert.ok(raises.length > 0, 'the panel can be raised at all');
  for (const line of raises) {
    assert.ok(/unix id/.test(line), `panel raises by name rather than pid: ${line.trim()}`);
  }
});

test('long panel content scrolls inside the window instead of escaping it', () => {
  // A gap can produce a 200-item to-do list. On a 620pt window that has to scroll,
  // and the header carrying the rung switcher has to stay reachable while it does.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html, /main\s*\{[^}]*overflow-y:\s*auto/, 'the content area scrolls');
  assert.match(html, /header\s*\{[^}]*position:\s*sticky/, 'the header stays put');
});

/**
 * The to-do view, executed rather than described.
 *
 * The panel is one HTML file with no build step, so its functions cannot be
 * imported. They can still be run: the two that decide the shape of this view are
 * lifted out of the file and evaluated, which tests the code that actually ships
 * instead of a copy of it that can drift away from it.
 */
function panelFn(...names) {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const esc = src.match(/^const esc = .*$/m)?.[0];
  assert.ok(esc, 'the escaper moved; this harness lifts it by name');
  const bodies = names.map((n) => {
    const at = src.indexOf(`function ${n}(`);
    assert.ok(at > -1, `${n} is not in panel.html`);
    // The parameter list is matched first, because a destructured default like
    // `{ indent = true } = {}` puts braces in the signature and brace-matching from
    // the name would stop at the end of those instead of the end of the body.
    let parens = 0;
    let i = src.indexOf('(', at);
    for (; i < src.length; i += 1) {
      if (src[i] === '(') parens += 1;
      else if (src[i] === ')' && (parens -= 1) === 0) break;
    }
    let depth = 0;
    i = src.indexOf('{', i);
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}' && (depth -= 1) === 0) break;
    }
    return src.slice(at, i + 1) + `\n__out.${n} = ${n};`;
  });
  const __out = {};
  new Function('__out', `${esc};${bodies.join('\n')}`)(__out);
  return __out;
}

test('finished items are rendered below the open ones, under their own heading', () => {
  const { todoListHtml, todoItemHtml } = panelFn('todoItemHtml', 'todoListHtml');
  const html = todoListHtml({
    id: 'n1',
    title: 'ToDO',
    counts: { total: 3, open: 1, done: 2 },
    items: [
      { key: 'a', noteId: 'n1', depth: 1, text: 'already done', done: true },
      { key: 'b', noteId: 'n1', depth: 1, text: 'still open', done: false },
      { key: 'c', noteId: 'n1', depth: 1, text: 'also done', done: true },
    ],
  });
  const open = html.indexOf('still open');
  const firstDone = html.indexOf('already done');
  const doneHead = html.indexOf('>Done<');
  assert.ok(open < doneHead, 'an open item is above the Done heading');
  assert.ok(doneHead < firstDone, 'a finished item is below the Done heading');
  assert.ok(html.indexOf('also done') > doneHead, 'every finished item is below it');
  assert.ok(typeof todoItemHtml === 'function');
});

test('the Done heading stays out of the way until something is done', () => {
  const { todoListHtml } = panelFn('todoItemHtml', 'todoListHtml');
  const nothingDone = todoListHtml({
    id: 'n1', title: 'ToDO', counts: { total: 1, open: 1, done: 0 },
    items: [{ key: 'a', noteId: 'n1', depth: 1, text: 'open', done: false }],
  });
  assert.match(nothingDone, /data-donehead[^>]*display:none/, 'an empty Done section is not shown');
  // It is present but hidden rather than absent, so a tick has somewhere to move to
  // without the list being rebuilt underneath the cursor.
  assert.ok(nothingDone.includes('data-done>'), 'the section still exists to receive the first tick');
});
