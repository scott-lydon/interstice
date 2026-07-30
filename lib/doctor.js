import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load } from './config.js';
import * as anki from './state/anki.js';
import { idleMs, frontmostApp, isRunning, activate, disableAppNap, readAppNap } from './state/system.js';
import { TranscriptWatcher } from './watcher.js';
import { COWORK_SESSIONS_ROOT, CLAUDE_CODE_PROJECTS, CLAUDE_SETTINGS, ROOT } from './paths.js';
import path from 'node:path';

const run = promisify(execFile);

// Anki ships two bundle ids and current builds run under the launcher. Setting
// only net.ankiweb.dtop looks right and has no effect.
const ANKI_BUNDLES = ['net.ankiweb.dtop', 'net.ankiweb.launcher'];

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
 * So doctor does not check that things *exist*. It checks that they *answer*,
 * under the conditions they will actually face.
 */

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

export async function runDoctor({ fix = false } = {}) {
  console.log('\ninterstice doctor\n');
  const results = [];
  const config = load();

  console.log('platform');
  results.push(
    await check('macOS', async () => {
      if (os.platform() !== 'darwin') throw new Error(`this is a macOS daemon (found ${os.platform()})`);
      return os.release();
    })
  );
  results.push(
    await check('node >= 20', async () => {
      const major = Number(process.versions.node.split('.')[0]);
      if (major < 20) throw new Error(`need node 20+, have ${process.versions.node}`);
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
          if (n === null) throw new Error('query failed');
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

  console.log('\nother rungs');
  results.push(
    await check(`${config.reading.app} installed`, async () => {
      if (!fs.existsSync(`/Applications/${config.reading.app}.app`)) {
        throw new Error(`/Applications/${config.reading.app}.app not found`);
      }
      return true;
    }, { required: false })
  );
  results.push(
    await check('Obsidian vault configured', async () => {
      const vault = path.join(os.homedir(), 'Documents', config.todo.vault);
      if (!fs.existsSync(vault)) throw new Error(`vault "${config.todo.vault}" not found`);
      return config.todo.vault;
    }, { required: false })
  );

  const failed = results.filter((r) => r === FAIL).length;
  const warned = results.filter((r) => r === WARN).length;

  console.log('');
  if (failed) {
    console.log(`${failed} required check(s) failed. Interstice will not work correctly until these pass.`);
  } else if (warned) {
    console.log(`All required checks passed. ${warned} optional check(s) warned; those rungs will be skipped.`);
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
