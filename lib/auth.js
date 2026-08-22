// Authentication for the local control surface.
//
// Binding to loopback is not access control. A page the user visits in an ordinary browser can
// reach 127.0.0.1, and `readBody` parses a JSON body regardless of content-type, so a plain
// cross-origin POST with `Content-Type: text/plain` is not preflighted and lands on a real
// handler. That surface reschedules Anki cards, writes to-do state, drives the daemon, and types
// keystrokes into a signed-in Amazon session. DNS rebinding additionally lets the attacker read
// the responses, because a name they control can be made to resolve to 127.0.0.1.
//
// Three cheap checks close it, and they are independent rather than redundant:
//   Host   defeats DNS rebinding: the rebound request still carries the attacker's name.
//   Origin defeats the no-preflight cross-origin POST: the browser sets it and a page cannot lie.
//   Token  defeats everything else that can reach the port, including a non-browser client on
//          this machine, and is the only one of the three a browser cannot supply by accident.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Where the per-daemon token lives. Mode 0600: readable by this user and nobody else. */
export function tokenPath(logDir) {
  return path.join(logDir, 'control-token');
}

/**
 * Read the per-daemon token, generating it on first run.
 *
 * Generated rather than configured, so there is no default value to forget to change, and no
 * secret in a file that gets committed. `logs/` is already gitignored.
 */
export function readOrCreateToken(logDir) {
  const file = tokenPath(logDir);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* first run, or an unreadable file we are about to replace */
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  // writeFileSync only applies the mode when it creates the file, so an existing file keeps its
  // old permissions. Set them explicitly.
  fs.chmodSync(file, 0o600);
  return token;
}

/** Read the token without creating one. Clients use this: only the daemon should mint it. */
export function readToken(logDir) {
  try {
    const token = fs.readFileSync(tokenPath(logDir), 'utf8').trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Compare two secrets without leaking their contents through how long the comparison took.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a length oracle, so both
 * sides are hashed to a fixed width first and the digests are compared.
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Hosts a legitimate local client can name. Anything else is somebody else's name for this port. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Decide whether a request may proceed.
 *
 * Returns `null` to allow, or `{ status, error }` to refuse. Kept pure and exported so the
 * decision can be tested directly, without standing up a server and firing real sockets at it.
 *
 * @param {object} req      minimal shape: `{ method, headers }`
 * @param {object} opts     `{ port, token, pathname }`
 */
export function checkRequest(req, { port, token, pathname }) {
  const headers = req.headers || {};

  // 1. Host. A DNS-rebound request resolves to this machine but still carries the attacker's
  //    hostname, because that is the name the browser was told to fetch.
  const host = String(headers.host || '');
  const hostname = host.replace(/:\d+$/, '');
  const hostPort = host.includes(':') ? host.slice(host.lastIndexOf(':') + 1) : '';
  if (!LOOPBACK.has(hostname) || (hostPort && hostPort !== String(port))) {
    return { status: 403, error: 'bad_host', detail: `refused Host ${JSON.stringify(host)}: this surface answers only to loopback on port ${port}` };
  }

  // 2. Origin. A same-origin fetch from the served pages sends this port's own origin; a page on
  //    any other site sends its own, and cannot forge it. Absent is fine: non-browser clients
  //    (the CLI, doctor, the hotkey shell) send no Origin, and they still have to pass the token.
  const origin = headers.origin;
  if (origin) {
    const ok = [...LOOPBACK].some((h) => origin === `http://${h}:${port}`);
    if (!ok) {
      return { status: 403, error: 'bad_origin', detail: `refused Origin ${JSON.stringify(origin)}: only this daemon's own pages may drive it` };
    }
  }

  // 3. Token. The HTML pages themselves are served unauthenticated, because the token is handed
  //    out by serving them; everything that reads or changes state needs it.
  if (isTokenExempt(pathname)) return null;
  const presented = headers['x-interstice-token'];
  if (!presented || !constantTimeEqual(String(presented), token)) {
    return {
      status: 401,
      error: 'unauthorized',
      detail: 'this endpoint needs the per-daemon control token',
      remedy: `send it as the x-interstice-token header; its value is the contents of logs/control-token`,
    };
  }
  return null;
}

/** The page loads themselves, which is how a browser is given the token in the first place. */
export function isTokenExempt(pathname) {
  return ['/', '/index.html', '/panel', '/debug', '/debug/'].includes(pathname);
}

/**
 * The bootstrap injected into every served page.
 *
 * It wraps `fetch` once rather than editing every call site across three HTML files: the pages
 * make dozens of requests, and a wrapper cannot be forgotten on the next `fetch` somebody adds.
 *
 * It does NOT reach requests the browser issues itself: an `<img src>`, a `<script src>`, an
 * `EventSource`. Those arrive with no token and are refused, which is correct but silent, so a
 * sub-resource that needs authenticating has to be fetched and handed to the element as an
 * object URL. `setReaderFrame` in web/panel.html is the one place that matters today.
 */
export function tokenBootstrap(token) {
  return (
    `<script>window.__INTERSTICE_TOKEN=${JSON.stringify(token)};` +
    `(function(f){window.fetch=function(u,o){` +
    `o=Object.assign({},o);` +
    `o.headers=Object.assign({},o.headers,{'x-interstice-token':window.__INTERSTICE_TOKEN});` +
    `return f.call(window,u,o);};})(window.fetch);</script>`
  );
}

/** Put the bootstrap in the document head, or at the top if the page has no head. */
export function injectToken(html, token) {
  const boot = tokenBootstrap(token);
  if (html.includes('<head>')) return html.replace('<head>', `<head>${boot}`);
  return boot + html;
}
