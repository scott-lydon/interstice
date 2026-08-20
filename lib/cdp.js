import { spawn } from 'node:child_process';

/**
 * A browser we drive, rather than one you look at.
 *
 * The book cannot be framed inside the panel: Amazon sends `x-frame-options:
 * SAMEORIGIN`, and the text is encrypted, so the only thing lawfully able to render
 * it is Amazon's own reader. That used to mean a second window, which is the
 * interruption this project exists to remove.
 *
 * So the reader runs where you cannot see it, and only its picture arrives. This is
 * the smallest client that can do that: launch a headless Chromium, speak the
 * DevTools protocol to it, take frames, hand back clicks and keys.
 *
 * No dependency, because nothing the daemon loads at runtime comes from npm. `WebSocket` is the one thing this
 * needs from the runtime, and it is only global from Node 22 onwards; the check is
 * explicit rather than a `WebSocket is not defined` from four frames deep.
 */

export const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function findBrowser(fs) {
  return BROWSERS.find((b) => fs.existsSync(b)) ?? null;
}

/** Every installed Chromium-family browser, in preference order. */
export function findBrowsers(fs) {
  return BROWSERS.filter((b) => fs.existsSync(b));
}

export function requireWebSocket() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `the in-panel reader needs Node 22 or newer for WebSocket (this is ${process.version})`
    );
  }
}

/**
 * Start a headless browser and wait for its debugging port to answer.
 *
 * The port is asked rather than assumed. Chrome writes `DevToolsActivePort` into
 * the profile once it is ready, and polling `/json/version` is the same fact
 * without having to know where the profile is; either way, returning before the
 * port is up turns every first call into a connection refused.
 */
export async function launchBrowser({
  bin,
  profile,
  port,
  extraArgs = [],
  timeoutMs = 20000,
  headless = true,
}) {
  requireWebSocket();
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    // Origins are unrestricted, because a CDP client sends none and Chrome would refuse it
    // otherwise. What keeps this private is the loopback bind of the debugging port above, not
    // this flag: anything that can reach the port can attach.
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--hide-scrollbars',
    '--mute-audio',
    ...extraArgs,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const child = spawn(bin, args, { stdio: 'ignore', detached: false });
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const version = await res.json();
      return { child, port, version, wsUrl: version.webSocketDebuggerUrl };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  child.kill('SIGKILL');
  throw new Error(
    `${bin.split('/').pop()} never opened its debugging port on ${port} within ${timeoutMs}ms: `
    + `${lastError?.message}. Remedy: some Chromium builds refuse to start the DevTools server at `
    + 'all, writing no DevToolsActivePort and binding no socket even with --remote-debugging-port=0. '
    + 'Install another Chromium-family browser (Brave, Edge, Chromium) and Interstice will use it.'
  );
}

/**
 * Launch the first installed browser whose debugging port actually answers.
 *
 * Installed is not the same as works. On this machine Google Chrome 151 starts, stays alive, and
 * never opens a DevTools port: no DevToolsActivePort file, no listening socket, nothing in its own
 * verbose log, and the same with `--remote-debugging-port=0` and a clean profile. Brave, sitting
 * beside it, opens the port immediately. The old code took the first browser that EXISTED and gave
 * up when it did not answer, so the reading rung was dead on a machine that had a working browser
 * installed the whole time, and the error it raised named neither what it tried nor what to do.
 *
 * @returns {Promise<object>} the first browser that answered, with `bin` on it
 */
export async function launchFirstWorkingBrowser({ fs, ...opts }) {
  const bins = findBrowsers(fs);
  if (!bins.length) {
    throw new Error(
      'no Chromium-family browser found. Remedy: install Google Chrome, Brave, Edge or Chromium.'
    );
  }
  const tried = [];
  for (const bin of bins) {
    try {
      const browser = await launchBrowser({ bin, ...opts });
      return { ...browser, bin };
    } catch (err) {
      tried.push(`${bin.split('/').pop()}: ${err.message.split('. Remedy')[0]}`);
    }
  }
  throw new Error(
    `no installed browser would open a debugging port. Tried ${tried.length}: ${tried.join(' | ')}. `
    + 'Remedy: install Brave or Chromium, which start the DevTools server where some Chrome builds '
    + 'now refuse to.'
  );
}

/**
 * One connection, many sessions.
 *
 * Every request carries an id and every reply names it, so calls are matched by id
 * rather than by order: the protocol answers out of order whenever a slow command
 * is followed by a fast one, and matching by arrival is a bug that only shows up
 * under load.
 */
export async function connect(wsUrl, { timeoutMs = 10000 } = {}) {
  requireWebSocket();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('devtools did not accept the connection')), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('devtools refused the connection')); }, { once: true });
  });

  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;
  let closed = false;

  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.method ?? ''})`)) : resolve(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  const fail = (reason) => {
    closed = true;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
  };
  ws.addEventListener('close', () => fail('the reader browser went away'), { once: true });

  function send(method, params = {}, sessionId, { timeoutMs: callTimeout = 20000 } = {}) {
    if (closed) return Promise.reject(new Error('the reader browser went away'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} did not answer in ${callTimeout}ms`));
      }, callTimeout);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  return {
    send,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get closed() {
      return closed;
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        /* already gone */
      }
    },
  };
}
