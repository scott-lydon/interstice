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
  // A gap can produce a 200-item to-do list. On a 900pt window that has to scroll,
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

test('the rung is in the URL, and a router-chosen rung is not', () => {
  // UX-NAV-001. The view was state the panel held and the address bar never knew, so a reload
  // always landed on cards and no rung could be linked to. Two halves matter equally, and the
  // second is the one worth a test: a view the ROUTER picked is not one you navigated to, so
  // writing it would let the daemon rewrite your address bar while you were looking at it.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const setView = html.slice(html.indexOf('function setView'), html.indexOf("/* ------------------------------------------------------------------ cards ---"));

  assert.match(setView, /searchParams\.set\('view', name\)/, 'the rung is written to the URL');
  assert.match(setView, /if \(!fromServer\) \{/, 'and only when the person chose it');
  assert.ok(
    setView.indexOf('if (!fromServer) {') < setView.indexOf("searchParams.set('view', name)"),
    'the guard comes before the write, not after it'
  );
  assert.match(setView, /replaceState/, 'replaceState, so a rung does not become a history entry');
  assert.ok(!/pushState/.test(setView), 'pushState would make the back button walk through polls');

  // And the boot path reads it back, refusing a value that is not a rung.
  assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\('view'\)/, 'read back at boot');
  assert.match(html, /hasOwnProperty\.call\(LOADERS, wanted\)/, 'an unknown view falls back rather than rendering nothing');
});

test('a user action never announces a success it did not establish', () => {
  // UX-SL-003. Two actions fired a request and then said it had worked. The Kindle button printed
  // "opened in Kindle" whether or not it opened, and the to-do toggle moved the row optimistically
  // and forgot the write, so a refusal left the panel showing an item as done that Notes never
  // recorded and the next reload silently put back.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  const kindle = html.slice(html.indexOf("$('read-app').onclick"), html.indexOf("// A book named in the URL wins"));
  assert.match(kindle, /try \{/, 'the Kindle open is guarded');
  assert.ok(
    kindle.indexOf('try {') < kindle.indexOf("say('opened in Kindle')"),
    'and the guard opens before the sentence that claims success'
  );
  assert.match(kindle, /Kindle did not open/, 'a refusal says so');

  const toggle = html.slice(html.indexOf("await fetch('/api/todos/toggle'") - 600, html.indexOf("await fetch('/api/todos/toggle'") + 1200);
  assert.match(toggle, /box\.checked = !box\.checked/, 'a refused toggle puts the checkbox back');
  assert.match(toggle, /did not save to Notes/, 'and says the write did not land');
});

test('the progress bars are driven by one mechanism, not two', () => {
  // A regression I introduced and nearly shipped. UX-ANIM-002 moved the bars off animating width,
  // a layout property, onto a transform: the element is drawn full width in CSS and squeezed. The
  // two bars still carried an inline style="width:0%" from before, and an inline style outranks a
  // stylesheet, so both bars were pinned at zero width and no transform could ever make them
  // visible. The CSS said one thing, the markup said another, and the markup won.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  // Scoped to the bars. Other elements legitimately carry an inline width: the shimmer skeleton
  // rows are deliberately uneven and a button is stretched to its container. A blanket assertion
  // here failed on those and would have been "fixed" by loosening it, which is how a test stops
  // testing the thing it was written for.
  const BARS = ['deck-bar', 'book-bar'];
  const barTags = BARS.map((id) => {
    const tag = (html.match(new RegExp(`<i id="${id}"[^>]*>`)) || [])[0];
    assert.ok(tag, `${id} is in the markup`);
    return tag;
  });
  assert.equal(barTags.length, BARS.length, 'every bar named above was found');
  for (const tag of barTags) {
    assert.ok(!/style="[^"]*width:/.test(tag), `no inline width on ${tag}`);
  }
  assert.match(html, /\.bar > i \{[^}]*width: 100%/, 'the bar is drawn full width');
  assert.match(html, /transform-origin: left center/, 'and squeezed from the left edge');
  for (const id of ['deck-bar', 'book-bar']) {
    assert.match(
      html,
      new RegExp(`id="${id}" style="transform:scaleX\\(0\\)"`),
      `${id} starts empty by the same mechanism that later fills it`
    );
  }
});

test('the page is pressed through a real button, not an image wearing a role', () => {
  // UX-A11Y-008. The page image carried role="button" and tabindex="0", which meant a screen
  // reader met an image claiming to be a control, and Enter and Space only worked because of a
  // hand-written keydown handler sitting beside it. A button does both for free.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  const img = (html.match(/<img id="reader-frame"[^>]*>/) || [])[0];
  assert.ok(img, 'the page image is still there');
  assert.ok(!/role="button"/.test(img), 'and no longer claims to be a control');
  assert.ok(!/tabindex/.test(img), 'nor takes focus itself');
  assert.match(img, /alt=""/, 'it is decorative, because the button carries the name');

  assert.match(html, /<button id="reader-tap"[^>]*aria-label="[^"]+"/, 'the button carries the name');

  // The hand-written key handler is the thing a real button makes unnecessary. Its absence is
  // the point of the change, so it is asserted rather than assumed.
  assert.ok(!/reader-frame'\)\.addEventListener\('keydown'/.test(html), 'no hand-written key handler survives');

  // A keyboard activation reports no coordinates. Pressing the top left corner is not what Enter
  // meant, and this is the branch that stops it.
  const handler = html.slice(html.indexOf("$('reader-tap').addEventListener('click'"));
  assert.match(handler.slice(0, 900), /e\.detail === 0/, 'a keyboard click is recognised');
  assert.match(handler.slice(0, 900), /readerPress\(0\.5, 0\.5\)/, 'and presses the middle');

  // The picture and the control around it are hidden together or the button outlives its content.
  assert.ok(!/reader-frame'\)\.hidden =/.test(html), 'nothing toggles the image on its own');
  assert.match(html, /const setFrameHidden/, 'one helper hides both');
});

test('a book that failed to open disables the pager instead of ignoring it', () => {
  // Items 1.6 and 1.7. When Amazon refuses the book there is no page, so turning one cannot work.
  // The sign-in state already disabled these three by hand; the failed-book state did not, because
  // its early return happens BEFORE the sign-in branch that was doing it. So Next stayed enabled
  // and silently did nothing, which is indistinguishable from a broken app.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  // One mechanism for both states, so a third state cannot disable two of the three and forget one.
  assert.match(html, /const setPagerDisabled = \(disabled, why\) =>/, 'the pager has one control point');
  const helper = html.slice(html.indexOf('const setPagerDisabled'), html.indexOf('const setFrameHidden'));
  for (const id of ['page-prev', 'page-next', 'reader-mode']) {
    assert.ok(helper.includes(id), `${id} goes through it`);
  }

  // The failure branch disables, and names why in the tooltip rather than leaving it blank.
  // Sliced FORWARD from the failure block. The first version searched for the next `} else {`
  // from the start of the file, which is hundreds of lines earlier, so the window never contained
  // the code under test and the assertion failed for a reason that had nothing to do with it.
  const failStart = html.indexOf("$('reader-failed-why').textContent");
  const failed = html.slice(failStart, html.indexOf('} else {', failStart));
  assert.match(failed, /setPagerDisabled\(true, '[^']+'\)/, 'the failure disables the pager with a reason');

  // And recovery gives them back. A guard that only ever disables is a different bug.
  const recStart = html.indexOf("// Back to a real page");
  const recovered = html.slice(recStart, html.indexOf('if (readerFailed) {', recStart));
  assert.match(recovered, /setPagerDisabled\(false/, 'recovery re-enables the pager');

  // Nothing sets `.disabled` on these by hand any more, or the two mechanisms would drift.
  assert.ok(
    !/el\.disabled = readerSignedOut/.test(html),
    'the sign-in state uses the same helper rather than its own copy'
  );
});

test('a refused retry says why, instead of clearing the line', () => {
  // Adversary finding 3, BLOCKING. The daemon computes ok, stage, expected, actual and a reason
  // ending in a remedy; the route serialises all five; the panel threw them away and then called
  // say('') to clear the line they would have gone on. The explanations were true of the daemon
  // and invisible in the product, and what a person saw after a refused retry was the panel
  // returning to "opening your book" over a spinner, which reads as the retry having worked.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const handler = html.slice(
    html.indexOf("$('reader-retry-yes').addEventListener"),
    html.indexOf("$('page-next').addEventListener")
  );
  assert.ok(handler.length > 0, 'the retry handler is found');

  assert.match(handler, /await r\.json\(\)/, "the response body is read rather than discarded");
  assert.match(handler, /outcome\.ok === false/, 'a refusal is distinguished from a success');
  assert.match(handler, /reader-failed-why'\)\.textContent = why/, 'and the reason is rendered');
  assert.match(handler, /setPagerDisabled\(true/, 'the pager stays disabled on a refusal');

  // The success path may clear the line. The refusal path must not, which is the regression.
  const refusal = handler.slice(handler.indexOf('outcome.ok === false'), handler.indexOf('} else {'));
  assert.ok(!/say\(''\)/.test(refusal), "a refusal does not clear the status line");
});


test('the destructive control is not offered for a failure it cannot fix', () => {
  // Item 2.1. `reader-retry` opens a confirmation about discarding the device registration
  // Amazon has stored here. That is the answer when Amazon refused this profile as a device. It
  // is useless AND destructive when the failure is a file missing from Amazon's CDN or a question
  // waiting to be answered on another device, and offering it there is the interface lying about
  // what the button does. One control at a time, chosen by which failure this is.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));

  const arm = (from, to) => branch.slice(branch.indexOf(from), branch.indexOf(to, branch.indexOf(from)));
  const asked = arm('if (askedSomething)', '} else if');
  const outage = arm('} else if (vendorBroken)', '} else {');
  // The third arm opens at the `} else {` that closes the second, not at the last one in the
  // slice: the last is the outer else, the one for a reader that came back.
  const refused = branch.slice(branch.indexOf('} else {', branch.indexOf('} else if (vendorBroken)')));

  // Matched on the choice, not on the whole call: the question arm passes options now, because
  // its remedy is the only one carried out somewhere else and it ships a link to get there.
  assert.match(asked, /setFailAction\('recheck'/, 'a question offers only the harmless control');
  assert.match(outage, /setFailAction\('recheck'/, "an outage on Amazon's side offers only the harmless control");
  assert.match(refused, /setFailAction\('retry'/, 'the registration failure offers the one that clears it');

  // And the helper really is exclusive, or the copy above is decoration.
  const helper = html.slice(html.indexOf('const setFailAction ='), html.indexOf('const setFrameHidden'));
  assert.match(helper, /reader-retry'\)\.hidden = which !== 'retry'/, 'retry is hidden unless chosen');
  assert.match(helper, /reader-recheck'\)\.hidden = which !== 'recheck'/, 'recheck is hidden unless chosen');
  assert.match(helper, /reader-retry-confirm'\)\.hidden = true/, 'a half-answered confirmation does not survive');

  // The harmless control must not reach the endpoint that clears anything.
  // Sliced to the end of the handler, not to a fixed number of characters. A count is a guess
  // about how long the code will stay: adding a comment to the handler pushed the call this
  // asserts on past the end of the window and failed the test without changing the behaviour.
  const recheckAt = html.indexOf("$('reader-recheck').addEventListener");
  const handler = html.slice(recheckAt, html.indexOf('});', recheckAt) + 3);
  assert.ok(!/reading\/retry/.test(handler), 'checking again does not call the clearing route');
  assert.match(handler, /tickReader\(\)/, 'it just asks the daemon again');
});

test('the failure surface reads as a heading and its evidence is legible', () => {
  // Item 2.1. Three failures share this surface, so the title carries the meaning rather than
  // labelling a section: `.label` is a 10px uppercase caption role at .14em tracking, and three
  // sentences of very different lengths set that way are a wall at the moment the reader most
  // needs to understand something.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const title = html.slice(html.indexOf('id="reader-failed-title"') - 120, html.indexOf('id="reader-failed-title"') + 60);
  assert.match(title, /class="failtitle"/, 'the title is set as a heading');
  assert.ok(!/class="label"/.test(title), 'and not as a caption');

  // The evidence line is the one string here that has to be read exactly, so it does not get
  // dimmed below the contrast floor. Computed, not asserted by eye: --muted #939EAC over
  // --raised #161A21 is 6.42:1, the same colour at opacity .75 is 4.18:1, and --faint #7B8693
  // is 4.71:1. Only one of those clears 4.5:1.
  const rule = html.slice(html.indexOf('.failwhat {'), html.indexOf('.failwhat[hidden]'));
  assert.match(rule, /color: var\(--faint\)/, 'the evidence line uses a token');
  assert.ok(!/opacity/.test(rule), 'and is not dimmed with opacity below the contrast floor');
  // The monospaced face belongs to the URL, not to every kind of evidence. A URL is read
  // character by character; Amazon's question is a sentence, and setting a sentence in 11px mono
  // says "machine output" and is harder to read. They shared one presentation with nothing
  // saying which was which.
  assert.match(html, /\.failwhat\.isurl \{ font-family: var\(--mono\)/, 'a URL is monospaced');
  assert.match(html, /\.failwhat\.isquote/, "and a question is not");
  assert.match(html, /id="reader-failed-detail-label"/, 'each is labelled with what it is');

  // The live region has to cover the part that names the failure, not only the paragraph that
  // explains it, or a screen reader hears an explanation of something never named.
  const surface = html.slice(html.indexOf('id="reader-failed"') - 200, html.indexOf('id="reader-failed-why"') + 80);
  const liveOnSurface = /id="reader-failed"[^>]*aria-live/.test(surface)
    || /aria-live[^>]*id="reader-failed"/.test(surface);
  assert.ok(liveOnSurface, 'the whole explanation is one live region');
  assert.ok(
    !/id="reader-failed-why"[^>]*aria-live/.test(surface),
    'and not a second one nested inside it, which would announce twice'
  );
});


test('every way of turning a page is stopped when there is no page', () => {
  // Pass 10 findings 3 and 4, both confirmed against the source. Disabling the pager buttons did
  // not disable turning. The arrow keys call `turnPage` directly, so a reader could arrow past a
  // book that had failed to open and watch nothing happen: the silent no-op that item 1.7
  // replaced for the buttons and left standing for the keyboard. And in immersive mode the main
  // pager is display:none (the `body.immersive` whitelist does not include it), so the only
  // pager on screen is the overlay, whose buttons forward by calling .click() on the disabled
  // ones: the turn was stopped, but the visible control stayed bright and did nothing.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  // One control point, guarded, rather than three call sites each remembering to check.
  const fn = html.slice(html.indexOf('async function turnPage(direction)'), html.indexOf('const held ='));
  assert.match(fn, /if \(readerFailed \|\| readerSignedOut\)/, 'turning is refused when there is no page');
  assert.match(fn, /readerSay\(/, 'and it says why rather than doing nothing');

  // The immersive buttons are disabled too, because in immersive mode they are the only ones seen.
  const helper = html.slice(html.indexOf('const setPagerDisabled ='), html.indexOf('const setFrameHidden'));
  for (const id of ['page-prev', 'page-next', 'reader-mode', 'page-prev-imm', 'page-next-imm']) {
    assert.ok(helper.includes(`'${id}'`), `${id} is disabled with the rest`);
  }

  // The premise the fix rests on: the main pager really is hidden in immersive mode, so if this
  // ever stops being true the extra ids become harmless rather than wrong.
  const whitelist = html.slice(html.indexOf('body.immersive #view-reading >'), html.indexOf('display: none; }', html.indexOf('body.immersive #view-reading >')));
  assert.ok(!/\.pager|#reader-pager\b/.test(whitelist), 'the main pager is not on the immersive whitelist');
  assert.match(html, /page-next-imm'\)\?\.addEventListener\('click', \(\) => document\.getElementById\('page-next'\)\?\.click\(\)\)/,
    'and the immersive buttons forward to the main ones');
});


test('a signed-out reader is never told their account is fine', () => {
  // Pass 10 finding 1, confirmed against the source. The failure surface returns early, before
  // the branch that renders the sign-in, so a reader whose session had expired while a failure
  // was showing got the failure's copy: "Your account and the book are both fine", next to a
  // button that discards their device registration. The panel had established nothing of the
  // kind. Not a missing explanation, a confident wrong one attached to an irreversible control.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  // The condition gained a second clause, so it is located by its stable head rather than by the
  // whole expression: the redraw is now keyed on which failure it is, not only on whether there
  // is one, because the copy was composed once on the way in and kept the previous failure's
  // words when the kind changed underneath it.
  const decide = html.slice(html.indexOf('const vendorBroken ='), html.indexOf('readerFailed = failing;') + 30);

  assert.match(decide, /const failing = !d\.signedOut &&/, 'signed out is not a failure of this kind');
  for (const flag of ['vendorBroken', 'askedSomething']) {
    const line = decide.slice(decide.indexOf(`const ${flag} =`), decide.indexOf(';', decide.indexOf(`const ${flag} =`)));
    assert.match(line, /!d\.signedOut/, `${flag} defers to a signed-out session`);
  }

  // The premise: the early return really does sit above the sign-in branch, so if that ever
  // changes this guard becomes redundant rather than wrong.
  const guard = html.indexOf('if (readerFailed) {', html.indexOf('const failing ='));
  const signin = html.indexOf('if (d.signedOut !== readerSignedOut)');
  assert.ok(guard > 0 && signin > guard, 'the failure surface still returns before the sign-in branch');

  // And the sentence that made it expensive is only ever reached when the session is not the
  // problem, which is the arm it belongs to.
  assert.match(html, /account and the book are both fine/, 'the sentence is still there for the case it is true of');
});


test('checking again says what it found, including nothing', () => {
  // Pass 10 finding 15. `renderReader` only repaints the failure surface when the condition
  // TRANSITIONS, so a check that finds the same answer repaints nothing: the spinner ran, the
  // button came back, and the screen was identical. A control whose only outcome is invisible
  // cannot be told apart from a broken one, and this control is offered precisely in the cases
  // where the answer usually has not changed yet.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const handler = html.slice(
    html.indexOf("$('reader-recheck').addEventListener"),
    html.indexOf('});', html.indexOf("$('reader-recheck').addEventListener")) + 3
  );
  assert.match(handler, /const before = /, 'it remembers what the failure said');
  assert.match(handler, /reader-recheck-said'\)\.hidden = false/, 'and reports an unchanged answer');
  assert.match(html, /id="reader-recheck-said"/, 'the element it reports into exists');

  // A fresh failure must not arrive carrying the previous check's outcome.
  const helper = html.slice(html.indexOf('const setFailAction ='), html.indexOf('const setFrameHidden'));
  assert.match(helper, /reader-recheck-said'\)\.hidden = true/, 'a new failure clears the old outcome');
});


test('the loading state ages, and does not animate under a failure', () => {
  // Pass 10 findings 5 and 6. The shimmer is this panel's signal for "still working", and it kept
  // animating under a hard named failure, so on a slow link a reader reads the animation and
  // waits for something that already stopped. And the loading line was re-fired every 1500ms with
  // an identical string, so five seconds and five minutes were pixel-identical.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  const say = html.slice(html.indexOf('function readerSay(text, spin)'), html.indexOf('function readerSay(text, spin)') + 900);
  assert.match(say, /\.skeleton/, 'the skeleton is governed by the same call that sets the words');
  assert.match(say, /hidden = !spin/, 'and it is only shown while something is actually in progress');

  // RUN it, rather than grep it. Asserting that the source contains the words "longer than
  // usual" passes just as well when that branch is unreachable: an early return above it froze
  // the line again and this test did not notice, which is the same vacuous assertion this loop
  // has now been caught making three separate times.
  const line = html.slice(html.indexOf('function openingLine()'), html.indexOf('function readerSay'));
  assert.match(line, /readerOpenedAt/, 'the line knows when the open began');
  const at = (secs) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('readerOpenedAt', 'Date', `${line}; return openingLine();`);
    return fn(1, { now: () => 1 + secs * 1000 });
  };
  const early = at(1);
  const middle = at(15);
  const late = at(120);
  assert.notEqual(early, middle, 'a wait of fifteen seconds does not look like a wait of one');
  assert.notEqual(middle, late, 'and two minutes does not look like fifteen seconds');
  assert.match(late, /longer than usual/, 'a long wait says so, so the reader can stop waiting');
  assert.match(middle, /15/, 'and the elapsed time is shown while it is still ordinary');
  // Every place that says it is opening goes through the ageing line, or the state stops ageing
  // on whichever path was missed.
  assert.equal(
    (html.match(/readerSay\('opening your book'/g) || []).length,
    0,
    'no site still says it with a frozen string'
  );
});

test('turning is unavailable until there is something to turn', () => {
  // Pass 10 finding 7. Enabling was reached only by the transition OUT of a failure, so an open
  // that never failed never enabled anything: the controls were live for the whole open because
  // they had never been disabled. On a slow link Next and See the real page could be pressed
  // against a book that did not exist yet, and nothing happened. That is the silent no-op the
  // failure states were fixed for, in the state that comes before them.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.slice(html.indexOf('function startReader(asin)'), html.indexOf('tickReader();', html.indexOf('function startReader(asin)')));
  assert.match(start, /setPagerDisabled\(true/, 'the pager starts unavailable');

  const arrival = html.slice(html.indexOf('setReaderFrame(img, d.seq);'), html.indexOf('setReaderFrame(img, d.seq);') + 500);
  assert.match(arrival, /setPagerDisabled\(false/, 'and becomes available when a page arrives');
  assert.match(arrival, /!readerFailed && !readerSignedOut/, 'but not over a failure or a sign-in');
});


test('a remedy names the control that is actually on screen', () => {
  // Pass 10 finding 13. Two controls did one job under two names: the per-page note's button said
  // "Read it again" and the failure surface's said "Try again". Three of the daemon's remedy
  // sentences and five of the panel's tell the reader to press "Read it again", and the note that
  // holds that button is hidden by the same branch that shows the failure. So the reader was told
  // to press a control that was not there while a differently named one sat in front of them.
  //
  // Scoped to that collision rather than to all prose. The first version of this test parsed
  // every "press X" in both files and demanded a button for each, which swallowed the word again
  // out of "press Cards again" and failed on a control named Cards that exists and is fine. A
  // test that tries to parse English produces false failures forever.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const daemon = fs.readFileSync(path.join(ROOT, 'lib', 'reader.js'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');

  // Scoped to the READER's remedies. The calendar has a retry of its own, labelled "Try again",
  // and its remedy correctly names it; sweeping the whole file caught that and would have forced
  // an unrelated surface to rename a button that was never wrong.
  const readerCopy = html.slice(html.indexOf('function readerRemedy'), html.indexOf('// Back to a real page'));
  const remedies = [...readerCopy.matchAll(/press (Read it again|Try again)/g)].map((m) => m[1])
    .concat([...daemon.matchAll(/press (Read it again|Try again)/g)].map((m) => m[1]));
  assert.ok(remedies.length >= 5, `the remedies do name this control: ${remedies.length} sites`);

  // Every one of them names the SAME control, and it is the one the failure surface shows.
  const distinct = [...new Set(remedies)];
  assert.deepEqual(distinct, ['Read it again'], `one action, one name: found ${distinct.join(' and ')}`);
  assert.match(flat, /id="reader-retry"[^>]*>Read it again</, 'and that is what the button says');

  // The control the remedies name must not be one the same branch has just hidden. `#read-again`
  // lives in `#reader-note`, which readerNote('') hides when the failure surface appears, so the
  // surface has to carry a control by that name itself, which is the assertion above.
  assert.match(html, /id="read-again"[^>]*>Read it again</, 'the note button keeps the same name too');
});


test('a confirmation does not default to the irreversible answer', () => {
  // Pass 10 finding 10. The confirmation exists because discarding the device registration is
  // irreversible and was one click away. Focusing "Discard it and reopen" put it one KEY away
  // instead: an operator who pressed Enter on the failure surface's button and, mid-thought,
  // pressed Enter again destroyed the registration without reading a word. A confirmation whose
  // default answer is the destructive one is not a confirmation.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  // Both ends anchored to this function. The end was computed from a global search for the focus
  // call, which found an earlier one elsewhere in the file and sliced a window that did not
  // contain this function at all.
  const askAt = html.indexOf('function readerRetryAsk(show)');
  const ask = html.slice(askAt, html.indexOf('\n}', askAt));
  assert.match(ask, /reader-retry-no'\)/, 'the keeping answer takes focus');
  assert.ok(!/show \? \$\('reader-retry-yes'\)/.test(ask), 'the discarding answer does not');

  // And the one that is focused really is the non-destructive one, by its label.
  const flat = html.replace(/\s+/g, ' ');
  assert.match(flat, /id="reader-retry-no"[^>]*>Keep it</, 'reader-retry-no is the keeping one');
  assert.match(flat, /id="reader-retry-yes"[^>]*>Discard it and reopen</, 'and yes is the destroying one');
});

test('the failure surface takes focus when it appears', () => {
  // Pass 10 finding 9. This surface appears by hiding whichever element held focus, which drops
  // focus to <body>, so the operator's next Tab started from the skip link at the top of the
  // document instead of at the control this surface is offering.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html.replace(/\s+/g, ' '), /id="reader-failed"[^>]*tabindex="-1"/, 'it can hold focus');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const arm = html.slice(start, html.indexOf('setFailAction', start));
  assert.match(arm, /reader-failed'\)\.focus/, 'and it takes focus when it is shown');
});

test('a shortened sentence reads as shortened, not as broken', () => {
  // Pass 10 finding 26. The daemon's sentence was cut at exactly 80 characters with no ellipsis,
  // so the footer ended mid-word and read as a rendering fault rather than as a truncation.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const src = html.slice(html.indexOf('function shorten(text, max)'), html.indexOf('function readerSay'));
  // eslint-disable-next-line no-new-func
  const shorten = new Function(`${src}; return shorten;`)();

  const long = 'The book was reloaded and has not come back. Remedy: press Read it again once more, and if it stays like this, sign in.';
  const out = shorten(long, 80);
  assert.ok(out.length <= 80, `it fits: ${out.length}`);
  assert.ok(out.endsWith('…'), 'it is marked as cut');
  assert.ok(!/ …$/.test(out), 'with no space before the mark');
  assert.ok(long.startsWith(out.slice(0, -1)), 'and it is a prefix of what it shortened');
  // The cut lands at a word boundary, so the last word is a whole word.
  const lastWord = out.slice(0, -1).split(' ').pop();
  assert.ok(long.split(/\s+/).includes(lastWord), `"${lastWord}" is a whole word`);
  // Something that already fits is returned untouched, mark and all.
  assert.equal(shorten('short one', 80), 'short one', 'a sentence that fits is not marked');
});


test('a failure surface is not painted over by controls that cannot help', () => {
  // Pass 10 finding 18. The hint band and the immersive pager pill are siblings of #reader with a
  // higher z-index, so in a short window they paint over this surface's lower edge and the one
  // control that CAN help ends up underneath two that cannot.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html, /body\.reader-failing \.reader-hint/, 'the hint band is hidden while failing');
  assert.match(html, /body\.reader-failing \.reader-pager-overlay/, 'and so is the pager pill');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const arm = html.slice(start, html.indexOf('if (readerFailed) {', start) + 40);
  assert.match(arm, /classList\.toggle\('reader-failing', readerFailed\)/, 'the class tracks the state');
});

test('the remedy that lives elsewhere ships a way to get there', () => {
  // Pass 10 finding 20. The question arm is the only failure whose remedy is carried out in
  // another application, and it shipped plain prose naming a web address the reader had to select,
  // copy and paste, at the moment they are least willing to do clerical work.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.match(flat, /id="reader-open-amazon"[^>]*target="_blank"/, 'there is a real link');
  assert.match(flat, /rel="noopener noreferrer"/, 'opened safely');

  // Shown for the question and for nothing else, or it becomes advice on failures it cannot help.
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));
  const asked = branch.slice(branch.indexOf('if (askedSomething)'), branch.indexOf('} else if'));
  assert.match(asked, /elsewhere: true/, 'the question arm asks for it');
  const outage = branch.slice(branch.indexOf('} else if (vendorBroken)'), branch.indexOf('} else {', branch.indexOf('} else if (vendorBroken)')));
  assert.ok(!/elsewhere: true/.test(outage), 'the outage arm does not, because going there does not help');

  const helper = html.slice(html.indexOf('const setFailAction ='), html.indexOf('const setFrameHidden'));
  assert.match(helper, /away\.hidden = !opts\.elsewhere/, 'and it is hidden by default');
  assert.match(helper, /encodeURIComponent/, 'the book id is escaped into the address');
});

test('a control does not present itself as the only way forward when a loop is already trying', () => {
  // Pass 10 finding 14. Check again duplicates what readerTimer does every 1500ms. Offering it as
  // the path forward, with nothing saying the panel is already doing it, overstates the control
  // and leaves a reader thinking nothing happens unless they press something.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));
  const outage = branch.slice(branch.indexOf('} else if (vendorBroken)'), branch.indexOf('} else {', branch.indexOf('} else if (vendorBroken)')));
  assert.match(outage, /keeps checking/, 'the copy says the panel is already rechecking');
  assert.match(outage, /by itself/, 'and that it will clear without being pressed');
});


test('the control that repairs an expired session is on screen, not behind a menu', () => {
  // Pass 10 finding 2. The sign-in box was rendered into #book-actions, which is on
  // READER_MENU_DISPLACED, so in immersive mode it is moved into the unlabelled ellipsis menu.
  // The one control that repairs an expired session went with it, and the reader was left with
  // the words "sign in" in 10px mono and no way to act on them without finding a menu nobody had
  // told them about. It lives in the reader now, beside the failure and loading overlays.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  assert.match(html, /id="reader-signin"/, 'the sign-in has a surface of its own');
  const render = html.slice(html.indexOf('function renderSignIn(d)'), html.indexOf('host.prepend(box)'));
  assert.match(render, /\$\('reader-signin'\)/, 'and renderSignIn puts it there');
  assert.ok(!/\$\('book-actions'\)/.test(render), 'not into the container immersive mode displaces');

  // The premise: book-actions really is displaced, so if that ever stops being true this move
  // becomes unnecessary rather than wrong.
  const displaced = html.slice(html.indexOf('const READER_MENU_DISPLACED'), html.indexOf('];', html.indexOf('const READER_MENU_DISPLACED')));
  assert.match(displaced, /'book-actions'/, 'book-actions is displaced into the menu');
  assert.ok(!/'reader-signin'/.test(displaced), 'and the new surface is not');

  // It is inside the reader, where the overlays that survive immersive live.
  const readerAt = html.indexOf('<div class="reader" id="reader">');
  const signinAt = html.indexOf('id="reader-signin"');
  const failedAt = html.indexOf('id="reader-failed"');
  assert.ok(readerAt > 0 && signinAt > readerAt, 'the surface is inside the reader');
  assert.ok(Math.abs(signinAt - failedAt) < 4000, 'beside the other overlays');
});


test('a refused turn points at the surface that explains it', () => {
  // Pass 10 finding 8. The reason a control is unavailable existed only as `el.title`, which a
  // disabled button never announces, never focuses and never fires on touch. Two halves fix it:
  // every state that disables the pager now has a visible surface saying why (the failure surface,
  // the sign-in surface, and the loading overlay's ageing line), and a refused turn moves focus to
  // whichever of those is showing.
  //
  // The narration alone could not have worked: readerSay writes into #reader-status, which lives
  // inside #reader-over, and that overlay is hidden whenever a failure or sign-in surface is up.
  // The sentence was going into a hidden element in exactly the state the guard exists for.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const fn = html.slice(html.indexOf('async function turnPage(direction)'), html.indexOf('const held ='));
  assert.match(fn, /reader-failed'\)\.hidden/, 'it looks for the failure surface');
  assert.match(fn, /reader-signin'\)\.hidden/, 'and for the sign-in surface');
  // Matched on the CONDITIONAL, not merely on the call. Asserting that the source mentions
  // shown.focus passed happily when the branch was changed to if (false), which is the same
  // vacuous shape this loop keeps producing: the text is present and unreachable.
  assert.match(fn, /if \(shown\) shown\.focus/, 'and sends the reader to whichever is showing');
  assert.match(fn, /else readerSay/, 'falling back to narration only when neither is up');

  // The premise: #reader-status really is inside #reader-over, so hiding one hides the other.
  const overAt = html.indexOf('id="reader-over"');
  const statusAt = html.indexOf('id="reader-status"');
  const overEnd = html.indexOf('</div>', html.indexOf('id="reader-status"'));
  assert.ok(overAt > 0 && statusAt > overAt && overEnd > statusAt, 'the status line is inside the loading overlay');
});


test('pass 11: the panel does not rule out what it cannot rule out', () => {
  // Pass 11 item 3, and the worst finding of the two reviews, because this loop exists to remove
  // exactly this and I wrote it while removing it. The vendor copy asserted that the failure was
  // Amazon's and not the account's, the book's, or this machine's, on the evidence that two
  // script requests did not come back. A dropped connection, a captive portal, a DNS filter, a
  // proxy and a content blocker all produce that same signal here, so on a filtered link the
  // panel told the reader in absolute terms not to look at the thing that was actually wrong.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const start = html.indexOf("$('reader-failed').hidden = !readerFailed;");
  const branch = html.slice(start, html.indexOf('// Back to a real page', start));
  const outage = branch.slice(branch.indexOf('} else if (vendorBroken)'), branch.indexOf('} else {', branch.indexOf('} else if (vendorBroken)')));

  assert.match(outage, /did not come back/, 'it reports the observation');
  assert.match(outage, /anything between/, 'and leaves the local causes on the table');
  assert.ok(!/not a problem with/.test(outage), 'it rules nothing out that it cannot rule out');
});

test('pass 11: a link that is a control is drawn as one', () => {
  // Pass 11 item 1. Every .act rule was qualified to `button`, so an <a class="act"> picked up
  // none of them and fell through to the bare `a` rule: on the question arm the reader saw a real
  // button that cannot resolve the state above an underlined blue sentence that can.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  // Asserted by SELECTOR, not by searching for a prefix: 'button.act {' also matches
  // '.pager button.act {', which is a different rule and correctly does not cover anchors.
  for (const selector of ['button.act, a.act {', 'button.act:hover, a.act:hover', 'button.act.primary, a.act.primary']) {
    assert.ok(html.includes(selector), `the anchor is covered by: ${selector}`);
  }
  assert.match(html, /a\.act \{[^}]*text-decoration: none/, 'and the anchor loses the link underline');
});

test('pass 11: the surface that prints a remedy carries the control it names', () => {
  // Pass 11 item 4. Four of the five readerRemedy sentences end by telling the reader to press a
  // button that lives on the failure surface, and the branch that prints them returns before that
  // surface is ever unhidden. The reader was told to do a thing and given no way to do it.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const branch = html.slice(html.indexOf('if (!d.ok) {'), html.indexOf('return;', html.indexOf('if (!d.ok) {')));
  assert.match(branch, /reader-over-act'\)\.hidden = false/, 'the control appears with the sentence');
  assert.match(branch, /setPagerDisabled\(true/, 'and the pager goes with the page');
  assert.match(html, /id="reader-over-act"/, 'the control exists');
  // One action, one name, still.
  assert.match(html.replace(/\s+/g, ' '), /id="reader-over-act"[^>]*>Read it again</, 'under the name every remedy uses');
});

test('pass 11: a failure that changes kind redraws', () => {
  // Pass 11 item 2. All of the failure copy was composed inside a test of the boolean, so it ran
  // once on the way in. A failure changing kind without a passing frame between kept the previous
  // one's title, paragraph, evidence, control choice and pager reason.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  assert.match(html, /const failKind = /, 'the kind is named');
  assert.match(html, /failing !== readerFailed \|\| failKind !== readerFailKind/, 'and a change of kind redraws');
  assert.match(html, /readerFailKind = ''/, 'and a fresh open forgets the last one');
});

test('pass 11: the destructive answer is not the recommended one', () => {
  // Pass 11 item 7. The irreversible answer wore the accent fill this panel uses for the
  // recommended action and was the brightest thing on the surface, while focus sat on the keeping
  // answer: colour and keyboard default disagreed about which answer was expected.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8').replace(/\s+/g, ' ');
  assert.match(html, /id="reader-retry-yes"[^>]*class="act danger"|class="act danger" id="reader-retry-yes"/, 'the discard is drawn as danger');
  assert.match(html, /class="act primary" id="reader-retry-no"|id="reader-retry-no"[^>]*class="act primary"/, 'and keeping is the recommended one');
  assert.match(html, /\.danger[^}]*var\(--crit\)/, 'danger uses the token that exists for it');
});

test('pass 11: evidence that can grow does not push the actions off the surface', () => {
  // Pass 11 item 8. Amazon's position prompts run to several sentences, the surface is top
  // aligned, and .reader only guarantees a 200px minimum, so a long question filled the box and
  // pushed both remedies below the fold with no scroll cue.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const rule = html.slice(html.indexOf('.failwhat.isquote {'), html.indexOf('}', html.indexOf('.failwhat.isquote {')));
  assert.match(rule, /max-height/, 'the quote is bounded');
  assert.match(rule, /overflow-y: auto/, 'and scrolls inside its own box');
});

test('pass 11: the sign-in surface names its state like its sibling does', () => {
  // Pass 11 items 5 and 6. Two overlays occupy the same rectangle and named their state at two
  // different ranks, and the sign-in one, which a reader lands in without warning, got the 10px
  // uppercase caption role that the failure surface had already rejected for this job. And the
  // cheap path overwrote its own label with an outcome and stayed disabled for the life of the
  // panel, so a reader who signed in elsewhere to fix exactly this could not retry it.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');
  const box = html.slice(html.indexOf("box.innerHTML ="), html.indexOf('host.prepend(box)'));
  assert.match(box, /h2 class="failtitle"/, 'the sign-in names its state as a heading');

  const handler = html.slice(html.indexOf("$('carry-session').textContent") >= 0
    ? html.indexOf("$('carry-session').textContent")
    : html.indexOf('signinSay(\'That session has expired'), html.indexOf('function watchSignIn'));
  assert.ok(!/carry-session'\)\.textContent = 'That session/.test(html), 'the label is not used as a status line');
  assert.match(handler, /carry-session'\)\.disabled = false/, 'and the control comes back');
});


test('nothing this panel hides can outrank the attribute that hides it', () => {
  // Three times now. `hidden` works through the user-agent rule `[hidden] { display: none }`, and
  // ANY author `display` on the same element outranks it, so an element the code hides stays on
  // screen and nothing anywhere reports a problem. It cost a bare "Read it again" button under
  // every page of the book, which is recorded above `.note`; it put the read.amazon.com link on
  // the outage arm, where going to Amazon lands on the same broken application; and it meant the
  // repair that stops a loading shimmer animating underneath a hard, named failure did nothing at
  // all, while a test that read the source was satisfied the assignment existed.
  //
  // So the invariant is asserted rather than the instances: every element this file toggles with
  // `hidden` must either take no author `display`, or carry its own `[hidden]` companion.
  const html = fs.readFileSync(path.join(ROOT, 'web', 'panel.html'), 'utf8');

  const toggled = new Set();
  for (const m of html.matchAll(/\$\('([\w-]+)'\)\.hidden\s*=/g)) toggled.add(m[1]);
  for (const m of html.matchAll(/getElementById\('([\w-]+)'\)\.hidden\s*=/g)) toggled.add(m[1]);
  assert.ok(toggled.size > 5, `the scan found the toggles: ${toggled.size}`);

  const guarded = (selector) => new RegExp(`${selector.replace('.', '\\.')}\\[hidden\\]`).test(html);
  const setsDisplay = (selector) =>
    new RegExp(`(^|[,\\s])${selector.replace('.', '\\.')}\\s*\\{[^}]*display:`, 'm').test(html);

  const unguarded = [];
  for (const id of toggled) {
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    const classes = tag ? (tag[0].match(/class="([^"]+)"/) || [])[1] : null;
    for (const sel of [`#${id}`, ...(classes ? classes.split(/\s+/).map((c) => `.${c}`) : [])]) {
      if (setsDisplay(sel) && !guarded(sel)) unguarded.push(`#${id} through ${sel}`);
    }
  }
  // The shimmer is reached through a querySelector rather than an id, so it is named explicitly.
  if (setsDisplay('.skeleton') && !guarded('.skeleton')) unguarded.push('.skeleton');

  assert.deepEqual(
    unguarded, [],
    `these are hidden by the code and cannot be: ${unguarded.join(', ')}`
  );
});
