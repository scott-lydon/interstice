import fs from 'node:fs';
import { readToken, tokenPath } from './auth.js';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCached } from './config.js';
import * as anki from './state/anki.js';
import { idleMs, frontmostApp, isRunning, activate, disableAppNap, readAppNap } from './state/system.js';
import { installedKindles, kindleState } from './state/kindle.js';
import { listNotes, scrapeTodoLists } from './state/notes.js';
import { binauralState, pomodoroState } from './state/companions.js';
import { hasAmazonSession, defaultChromeCookies } from './amazon-session.js';
import { READER_PROFILE } from './reader.js';
import { findBrowser } from './cdp.js';
import net from 'node:net';
import { applyOverrides } from './todo-store.js';
import { launchAgentJob, daemonPidOnPort, LAUNCH_LABEL } from './install.js';
import { screenFrame, placeBottomRight } from './panel.js';
import { TranscriptWatcher } from './watcher.js';
import { COWORK_SESSIONS_ROOT, CLAUDE_CODE_PROJECTS, CLAUDE_SETTINGS, ROOT, LAUNCH_AGENT, LOG_DIR } from './paths.js';
import path from 'node:path';

const run = promisify(execFile);

/**
 * The reading rung's three silent failure modes, decided from plain booleans so a test can induce
 * each without a live browser or a bound port. Returns the first specific, remedy-bearing failure,
 * or ok. Order matters: no browser makes the port and session moot, so it is named first.
 */
export function readingRungDiagnosis({ browserFound, portFree, sessionCarried }) {
  if (!browserFound) {
    return { ok: false, message: 'no Chromium-family browser to render the book. Remedy: install Google Chrome.' };
  }
  if (!portFree) {
    return { ok: false, message: 'the reader debugging port is already in use. Remedy: stop whatever holds it, or set readerPort in the config.' };
  }
  if (!sessionCarried) {
    return { ok: false, message: 'the reader has no carried Amazon session. Remedy: sign in to Amazon once in your ordinary Chrome and it is carried across.' };
  }
  return { ok: true, message: 'browser present, port free, session carried' };
}

/** Whether a TCP port can be bound right now. Resolves false when something already holds it. */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** The frontmost-app signal: a readable app name means the breaker can see distractions. */
export function frontmostSignalDiagnosis(app) {
  if (app && typeof app === 'string') return { ok: true, message: `frontmost app is readable (${app})` };
  return { ok: false, message: 'the frontmost-app signal is unreadable. Remedy: ensure /usr/bin/lsappinfo exists and runs; a focus block cannot be broken by an app it cannot see.' };
}

/** The display and lock signal: the probe must return a boolean, not error. */
export function lockSignalDiagnosis({ ok, value }) {
  if (ok && typeof value === 'boolean') return { ok: true, message: `screen-lock signal is readable (locked=${value})` };
  return { ok: false, message: 'the screen-lock signal is unreadable. Remedy: ensure /usr/sbin/ioreg and /usr/bin/plutil exist; without it, a screen lock cannot forfeit a block.' };
}

/**
 * The browser video probe: how many of the configured endpoints answered.
 *
 * Zero is reported as a pass with an explanation rather than a failure, because a browser that is
 * not running is the ordinary case and not a broken install. Zero CONFIGURED endpoints is worth
 * saying separately: it means video can never break a block, which a reader who set a whitelist
 * would not otherwise learn.
 */
export function videoProbeDiagnosis(reachable, configured = null) {
  if (reachable > 0) {
    return { ok: true, message: `${reachable} of ${configured ?? reachable} browser endpoint(s) answered the video probe` };
  }
  if (configured === 0) {
    return {
      ok: true,
      message: 'no browsers are configured under focus.videoBrowsers, so video can never break a block',
    };
  }
  return { ok: true, message: 'no browser is exposing a debugging endpoint right now; video breaks are inactive until one does' };
}


// Anki ships two bundle ids and current builds run under the launcher. Setting
// only net.ankiweb.dtop looks right and has no effect.
const ANKI_BUNDLES = ['net.ankiweb.dtop', 'net.ankiweb.launcher'];

// The panel needs a Chromium-family browser for its chromeless `--app` window.
const PANEL_BROWSERS = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Chromium'];

const PASS = 'PASS';
const FAIL = 'FAIL';
const WARN = 'WARN';

function line(status, name, detail) {
  const mark = status === PASS ? '✓' : status === WARN ? '!' : '✗';
  const pad = name.padEnd(38);
  console.log(`  ${mark} ${pad} ${detail ?? ''}`.trimEnd());
}

async function check(name, fn, { required = true } = {}) {
  try {
    const result = await fn();
    if (result === false) {
      line(required ? FAIL : WARN, name, 'failed');
      return required ? FAIL : WARN;
    }
    line(PASS, name, typeof result === 'string' ? result : '');
    return PASS;
  } catch (err) {
    line(required ? FAIL : WARN, name, err.message);
    return required ? FAIL : WARN;
  }
}

/**
 * Preflight.
 *
 * Two dependencies can silently null the entire system, and neither announces
 * itself when it breaks:
 *
 *   1. macOS App Nap suspends Anki when it is backgrounded, which is exactly its
 *      state when we query it, and AnkiConnect then stops answering. Symptom:
 *      nothing happens, no error anywhere.
 *   2. The Cowork transcript path changes and detection goes quiet. Symptom:
 *      also nothing happens.
 *
 * So doctor does not stop at checking that things *exist*. Where it can, it checks that they
 * *answer*,
 * under the conditions they will actually face.
 */

export async function runDoctor({ fix = false } = {}) {
  console.log('\ninterstice doctor\n');
  const results = [];
  const config = loadCached();

  console.log('platform');
  results.push(
    await check('macOS', async () => {
      if (os.platform() !== 'darwin') throw new Error(`this is a macOS daemon (found ${os.platform()})`);
      return os.release();
    })
  );
  results.push(
    await check('node >= 22', async () => {
      const major = Number(process.versions.node.split('.')[0]);
      // 22, not 20: `WebSocket` is only global from 22, and the in-panel reader speaks CDP
      // over it. On 20 everything else works and the reading rung throws on first use, which
      // is exactly the silent dependency doctor exists to surface.
      if (major < 22) {
        throw new Error(
          `need node 22+ for the in-panel reader (global WebSocket), have ${process.versions.node}. `
          + 'Remedy: brew upgrade node, or run everything except the reading rung on 20.'
        );
      }
      return `v${process.versions.node}`;
    })
  );

  console.log('\ndetection');
  results.push(
    await check('Cowork sessions directory', async () => {
      if (!fs.existsSync(COWORK_SESSIONS_ROOT)) {
        throw new Error(`missing: ${COWORK_SESSIONS_ROOT}`);
      }
      return COWORK_SESSIONS_ROOT.replace(os.homedir(), '~');
    }, { required: config.surfaces.cowork })
  );

  results.push(
    await check('Cowork transcripts found', async () => {
      const found = countTranscripts(COWORK_SESSIONS_ROOT, 1);
      if (found === 0) throw new Error('no .jsonl transcripts yet (run one Cowork prompt, then retry)');
      return `${countTranscripts(COWORK_SESSIONS_ROOT, 5000)} files`;
    }, { required: false })
  );

  results.push(
    await check('FSEvents delivers a nested write', async () => {
      const ms = await proveFsEvents();
      return `${ms}ms end to end`;
    })
  );

  results.push(
    await check('Claude Code hooks registered', async () => {
      if (!fs.existsSync(CLAUDE_SETTINGS)) throw new Error('no ~/.claude/settings.json');
      const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      const hooks = JSON.stringify(s.hooks ?? {});
      if (!hooks.includes('interstice')) throw new Error('not installed (run: interstice install)');
      return 'UserPromptSubmit + Stop';
    }, { required: false })
  );

  console.log('\nstartup');
  results.push(
    await check('LaunchAgent installed', async () => {
      if (!fs.existsSync(LAUNCH_AGENT)) throw new Error('not installed (run: interstice install)');
      return LAUNCH_AGENT.replace(os.homedir(), '~');
    }, { required: false })
  );
  results.push(
    await check('the LaunchAgent is loaded, not merely present', async () => {
      // A plist on disk says nothing about whether launchd ever accepted it, and the next check
      // down ("the daemon is answering") is satisfied just as well by a daemon somebody started
      // by hand in a terminal, which is exactly the state where login start is silently broken.
      // Only launchd knows, so ask launchd, and then compare the pid it reports against the pid
      // the daemon on the port reports for itself: same number, or the port is somebody else's.
      const job = await launchAgentJob();
      if (!job.loaded) throw new Error(`${LAUNCH_LABEL} is not loaded (run: interstice install)`);
      if (job.pid == null) {
        throw new Error(
          `${LAUNCH_LABEL} is loaded but not running (last exit status ${job.lastExitStatus ?? 'unknown'}); ` +
          `see logs/launchd.err.log`
        );
      }
      const answering = await daemonPidOnPort(config.port);
      if (answering == null) return `pid ${job.pid} (nothing answering on ${config.port} yet)`;
      if (answering !== job.pid) {
        throw new Error(
          `port ${config.port} is answered by pid ${answering}, not the agent's ${job.pid}: a daemon ` +
          `started by hand is holding the port, so the agent's copy is not the one you are using`
        );
      }
      return `pid ${job.pid}, and it is the process answering on ${config.port}`;
    }, { required: false })
  );
  results.push(
    await check('the node it launches still exists', async () => {
      if (!fs.existsSync(LAUNCH_AGENT)) throw new Error('no LaunchAgent to check');
      const plist = fs.readFileSync(LAUNCH_AGENT, 'utf8');
      const nodePath = plist.match(/<string>([^<]*node)<\/string>/)?.[1];
      if (!nodePath) throw new Error('no node path in the plist');
      // A Homebrew upgrade removes the versioned Cellar directory the plist was
      // written with. The job then fails at every login and the only symptom is
      // Interstice never appearing, which looks exactly like a quiet day.
      if (!fs.existsSync(nodePath)) throw new Error(`${nodePath} is gone (run: interstice install)`);
      if (nodePath.includes('/Cellar/')) {
        throw new Error(`${nodePath} is a versioned path; a node upgrade will break it (run: interstice install)`);
      }
      return nodePath;
    }, { required: false })
  );
  results.push(
    await check('the daemon is answering right now', async () => {
      const token = readToken(LOG_DIR);
      const res = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
        headers: token ? { 'x-interstice-token': token } : {},
        signal: AbortSignal.timeout(2500),
      }).catch(() => null);
      if (res?.status === 401) {
        throw new Error(
          `the daemon refused this check as unauthorized. Remedy: the control token at ${tokenPath(LOG_DIR)} ` +
          `does not match the running daemon's; restart the daemon so both read the same file.`
        );
      }
      if (!res?.ok) throw new Error(`nothing is listening on ${config.port} (run: interstice start)`);
      const health = await res.json();
      return `pid ${health.pid}, up ${Math.round(health.uptimeSec / 60)}m, ${health.counters.gaps} gaps this run`;
    }, { required: false })
  );

  console.log('\nanki');
  const ankiInstalled = fs.existsSync('/Applications/Anki.app');
  results.push(
    await check('Anki installed', async () => {
      if (!ankiInstalled) throw new Error('/Applications/Anki.app not found');
      return true;
    }, { required: false })
  );

  if (ankiInstalled) {
    if (fix) {
      const written = await disableAppNap(ANKI_BUNDLES);
      line(PASS, 'App Nap disabled for Anki', `${written.join(', ')} (restart Anki to apply)`);
    } else {
      results.push(
        await check('App Nap disabled for Anki', async () => {
          const states = await Promise.all(ANKI_BUNDLES.map((b) => readAppNap(b)));
          const missing = ANKI_BUNDLES.filter((_, i) => !states[i]);
          if (missing.length) {
            throw new Error(`unset for ${missing.join(', ')}. Backgrounded Anki will stop answering. Fix: interstice doctor --fix`);
          }
          return ANKI_BUNDLES.join(', ');
        }, { required: false })
      );
    }

    results.push(
      await check('AnkiConnect endpoint', async () => {
        const ep = anki.endpoint(config);
        return `${ep.url} (${ep.source})`;
      }, { required: false })
    );

    const running = await isRunning('Anki');
    results.push(
      await check('AnkiConnect answers', async () => {
        if (!running) throw new Error('Anki is not running (launch it, then retry)');
        const v = await anki.version(config);
        return `version ${v}`;
      }, { required: false })
    );

    if (running) {
      results.push(
        await check('AnkiConnect answers while backgrounded', async () => {
          // The real test. Push Anki behind another app, then query it. This is the
          // exact condition under which App Nap kills the bridge.
          const before = await frontmostApp();
          if (before && before !== 'Anki') {
            const v = await anki.version(config);
            return `yes (frontmost was ${before})`;
          }
          await activate('Finder');
          await new Promise((r) => setTimeout(r, 1500));
          const v = await anki.version(config);
          if (before) await activate(before).catch(() => {});
          return `yes (version ${v})`;
        }, { required: false })
      );

      results.push(
        await check('due-card query', async () => {
          const n = await anki.dueCount(config);
          if (n === null) {
            // `dueCount` answers null for "unavailable", never for zero, and it swallows the
            // underlying error on purpose so the router can tell the two apart. That left this
            // line as the only thing the operator sees, and "query failed" named neither the
            // query, the endpoint, nor a way forward, which every other check in this file does.
            const ep = anki.endpoint(config);
            const query = config.anki?.deck ? `deck:"${config.anki.deck}" is:due` : 'is:due';
            throw new Error(
              `AnkiConnect "findCards" with query ${JSON.stringify(query)} returned no answer from ` +
                `${ep.url} (${ep.source}). Fix: confirm the AnkiConnect addon is enabled in Anki, ` +
                `that no dialog inside Anki is holding the collection` +
                (config.anki?.deck ? `, and that a deck named "${config.anki.deck}" exists` : '') +
                `, then retry`
            );
          }
          return `${n} due`;
        }, { required: false })
      );
    }
  }

  console.log('\nsystem access');
  results.push(
    await check('idle time readable', async () => {
      const ms = await idleMs();
      if (ms === null) throw new Error('HIDIdleTime unreadable');
      return `${Math.round(ms)}ms idle`;
    })
  );
  results.push(
    await check('frontmost app readable', async () => {
      const app = await frontmostApp();
      if (!app) throw new Error('needs Automation permission for System Events');
      return app;
    })
  );

  console.log('\npanel');
  results.push(
    await check('a browser can host the panel', async () => {
      const found = PANEL_BROWSERS.filter((b) => fs.existsSync(`/Applications/${b}.app`));
      if (!found.length) throw new Error(`none of: ${PANEL_BROWSERS.join(', ')}`);
      return found[0];
    })
  );
  results.push(
    await check('screen geometry readable', async () => {
      const frame = await screenFrame();
      if (frame.source === 'fallback') throw new Error('NSScreen unreadable, panel will use a guessed size');
      const box = placeBottomRight(frame, {
        width: config.panel?.width ?? 440,
        height: config.panel?.height ?? 620,
        margin: config.panel?.margin ?? 24,
      });
      return `${frame.width}x${frame.height} → panel at ${box.x},${box.y} ${box.width}x${box.height}`;
    }, { required: false })
  );

  console.log('\nreading');
  results.push(
    await check('Kindle installed', async () => {
      const found = installedKindles();
      if (!found.length) throw new Error('no Kindle app found');
      // Both macOS Kindle apps register the same URL scheme, and only the newer one
      // records a reading position. Say which one is being used and why.
      return found.map((k) => `${k.app} (${k.generation}${k.hasBookData ? ', positions' : ''})`).join(', ');
    }, { required: false })
  );
  results.push(
    await check('the library is readable at all', async () => {
      const state = await kindleState(config);
      // macOS keeps another application's container behind Full Disk Access, and a
      // launchd job cannot raise that prompt: the read comes back "Operation not
      // permitted", or blocks until something answers a dialog nobody saw. Both
      // look from the outside like owning no books.
      if (state.reason === 'book_data_forbidden') {
        throw new Error(
          `${state.detail ?? 'refused'} → answer the "node would like to access data from other apps" `
          + 'prompt, or add node under Privacy & Security → Full Disk Access'
        );
      }
      if (String(state.reason).startsWith('book_data_unreadable')) throw new Error(state.detail ?? state.reason);
      return `${state.started} book${state.started === 1 ? '' : 's'} with a saved position`;
    }, { required: false })
  );
  results.push(
    await check('the reader is signed in', async () => {
      // The reader has its own browser profile, so being signed in to Amazon in your
      // ordinary Chrome does not sign you in there. The session is carried across the
      // first time it opens, and again by itself whenever Amazon has rotated it; if
      // neither profile has one, the rung shows a sign-in page instead of your book,
      // which looks like the rung being broken.
      const reader = path.join(READER_PROFILE, 'Default', 'Cookies');
      const yours = await hasAmazonSession(config.reading?.chromeCookies ?? defaultChromeCookies());
      if (await hasAmazonSession(reader)) {
        return yours
          ? 'the reader carries your Amazon session'
          : 'the reader has a session, though your own Chrome no longer does';
      }
      throw new Error(
        yours
          ? 'not yet carried across; it happens the first time the book rung opens'
          : 'sign in to Amazon in your ordinary Chrome once, and it will be carried across'
      );
    }, { required: false })
  );
  results.push(
    await check('the reading rung can open a book', async () => {
      const browserFound = !!findBrowser(fs);
      const readerPort = config.reading?.readerPort ?? 7421;
      // Together rather than one after the other: a bind attempt and a cookie-store
      // read share nothing, and doctor is a command somebody is sitting and watching.
      const [portFree, sessionCarried] = await Promise.all([
        portIsFree(readerPort),
        hasAmazonSession(path.join(READER_PROFILE, 'Default', 'Cookies')),
      ]);
      const diagnosis = readingRungDiagnosis({ browserFound, portFree, sessionCarried });
      if (!diagnosis.ok) throw new Error(diagnosis.message);
      return diagnosis.message;
    }, { required: false })
  );
  results.push(
    await check('the frontmost-app signal is readable', async () => {
      const diagnosis = frontmostSignalDiagnosis(await frontmostApp().catch(() => null));
      if (!diagnosis.ok) throw new Error(diagnosis.message);
      return diagnosis.message;
    }, { required: false })
  );
  results.push(
    await check('the screen-lock signal is readable', async () => {
      const { screenLocked } = await import('./focus/breakers/display.js');
      let ok = true, value;
      try { value = await screenLocked(); } catch { ok = false; }
      const diagnosis = lockSignalDiagnosis({ ok, value });
      if (!diagnosis.ok) throw new Error(diagnosis.message);
      return diagnosis.message;
    }, { required: false })
  );
  results.push(
    await check('the browser video probe can attach', async () => {
      // Actually ask. This passed a hard-coded zero and therefore always reported that no browser
      // was exposing an endpoint, which is exactly the assumption a doctor check exists to
      // replace: it printed a green tick for a signal it had never contacted.
      //
      // Read-only, and it never launches a browser: an endpoint that is not there is a real
      // answer (video breaks are inactive), not a thing to force into existence.
      const endpoints = config.focus?.videoBrowsers ?? [];
      let reachable = 0;
      for (const b of endpoints) {
        try {
          // The configured shape is { name, wsUrl }, and there is no `port` field: reading one
          // produced `http://127.0.0.1:undefined/...`, which throws before a socket is opened and
          // lands in the catch below, so this reported zero exactly as reliably as the hard-coded
          // zero it replaced. The port comes out of the endpoint the probe itself dials.
          const res = await fetch(`http://127.0.0.1:${new URL(b.wsUrl).port}/json/version`, {
            signal: AbortSignal.timeout(1200),
          });
          if (res.ok) reachable += 1;
        } catch {
          /* an unreachable browser is not an error here; it is simply no video */
        }
      }
      const diagnosis = videoProbeDiagnosis(reachable, endpoints.length);
      return diagnosis.message;
    }, { required: false })
  );
  results.push(
    await check('a book in progress is identifiable', async () => {
      const state = await kindleState(config);
      if (!state.book) throw new Error(state.reason);
      const from = state.stale ? ` (remembered from ${new Date(state.staleSince).toLocaleTimeString()})` : '';
      return `${state.book.title.slice(0, 34)} at ${state.book.percent}%${from}`;
    }, { required: false })
  );

  console.log('\ncompanions');
  results.push(
    await check(`${config.companions?.binaural?.app ?? 'Music'} answers`, async () => {
      const b = await binauralState(config);
      // Not running is a legitimate reading, not a broken probe: the check is that
      // the app answers when asked, which it just did by saying it is not there.
      return `${b.verdict} · ${b.detail}${b.track ? ` · ${b.track.slice(0, 40)}` : ''}`;
    }, { required: false })
  );
  results.push(
    await check(`${config.companions?.pomodoro?.app ?? 'Be Focused'} timer readable`, async () => {
      const p = await pomodoroState(config);
      // The countdown on the menu bar is the only place this timer is legible, so
      // reading it needs Screen Recording. Without that the reading is "unknown"
      // and the panel says nothing, which is silence that looks exactly like a
      // working check: name it here instead.
      if (p.verdict === 'unknown') {
        throw new Error(`${p.detail} (grant Screen Recording to whatever runs the daemon)`);
      }
      return `${p.verdict} · ${p.detail}`;
    }, { required: false })
  );

  console.log('\nto-do');
  results.push(
    await check('Notes answers Apple events', async () => {
      // The store itself is TCC protected and needs Full Disk Access; scripting the
      // app needs only the Automation grant, which is the whole reason it is read
      // this way. A refusal here shows up as an empty rung, not an error.
      //
      // Interstice will not start Notes, so with Notes closed there is nothing to
      // ask and nothing wrong. Say so rather than reporting a fault.
      if (!(await isRunning('Notes'))) return 'skipped: Notes is closed (nothing starts it)';
      const notes = await listNotes({ timeoutMs: 20000 });
      if (!notes.length) throw new Error('no notes returned (grant Automation for Notes)');
      return `${notes.length} notes`;
    }, { required: false })
  );
  results.push(
    await check('a to-do list is found and parsed', async () => {
      const scraped = await scrapeTodoLists(config, { timeoutMs: 25000 });
      if (!scraped.available) throw new Error(scraped.reason);
      const lists = applyOverrides(scraped.lists);
      return lists.map((l) => `${l.title.slice(0, 24)} (${l.counts.open} open)`).join(', ');
    }, { required: false })
  );

  const failed = results.filter((r) => r === FAIL).length;
  const warned = results.filter((r) => r === WARN).length;

  console.log('');
  if (failed) {
    console.log(`${failed} required check(s) failed. Interstice will not work correctly until these pass.`);
  } else if (warned) {
    console.log(`All required checks passed. ${warned} optional check(s) warned; whatever they cover is unavailable.`);
  } else {
    console.log('All checks passed.');
  }
  console.log('');
  return failed === 0;
}

function countTranscripts(root, limit) {
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  const stack = [root];
  while (stack.length && n < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
      else if (e.name.endsWith('.jsonl') && e.name !== 'audit.jsonl') n += 1;
      if (n >= limit) break;
    }
  }
  return n;
}

/**
 * Prove the detection mechanism itself, in the shape that actually matters: a file
 * appearing in a directory tree that did not exist when the watch started.
 */
async function proveFsEvents() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-doctor-'));
  const w = new TranscriptWatcher({ root: tmp, surface: 'doctor', seedOffsets: false }).start();
  if (!w.started) throw new Error('fs.watch could not start');

  const started = Date.now();
  const got = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no event within 3s')), 3000);
    w.once('submit', () => {
      clearTimeout(timer);
      resolve(Date.now() - started);
    });
  });

  const deep = path.join(tmp, 'a/b/c/.claude/projects/slug');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(
    path.join(deep, 'probe.jsonl'),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'doctor probe' },
      promptId: 'doctor',
      timestamp: new Date().toISOString(),
    }) + '\n'
  );

  try {
    return await got;
  } finally {
    w.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
