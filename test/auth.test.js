// The control surface used to accept every request that could reach the port, and
// loopback binding is not access control: a page the user visits can POST to 127.0.0.1, and
// `readBody` parses JSON regardless of content-type, so the request is not preflighted and lands
// on a real handler. That surface reschedules Anki cards, writes to-do state, drives the daemon,
// and types keystrokes into a signed-in Amazon session.
//
// These tests pin the three checks and, in the second half, fire real sockets at a real server so
// the pinning cannot pass while the wiring is wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

import {
  checkRequest,
  constantTimeEqual,
  readOrCreateToken,
  readToken,
  tokenPath,
  injectToken,
  isTokenExempt,
} from '../lib/auth.js';

const PORT = 7420;
const TOKEN = 'a'.repeat(64);
const good = (over = {}) => ({
  method: 'POST',
  headers: { host: `127.0.0.1:${PORT}`, 'x-interstice-token': TOKEN, ...over },
});
const decide = (req, pathname = '/api/queued') =>
  checkRequest(req, { port: PORT, token: TOKEN, pathname });

test('a correctly tokened same-origin request is allowed', () => {
  assert.equal(decide(good()), null);
  assert.equal(decide(good({ origin: `http://127.0.0.1:${PORT}` })), null);
  assert.equal(decide(good({ origin: `http://localhost:${PORT}` })), null);
  // Non-browser clients (the CLI, doctor, the hotkey shell) send no Origin at all.
  const noOrigin = good();
  delete noOrigin.headers.origin;
  assert.equal(decide(noOrigin), null);
});

test('a cross-origin POST is refused even when it carries the token', () => {
  // The exact shape the audit fired live: a no-preflight POST from a page the user is visiting.
  const r = decide(good({ origin: 'https://evil.example' }));
  assert.equal(r.status, 403);
  assert.equal(r.error, 'bad_origin');
});

test('a DNS-rebound request is refused by its Host', () => {
  // Rebinding makes the attacker's name resolve here, but the browser still sends that name.
  const r = decide(good({ host: 'attacker.example' }));
  assert.equal(r.status, 403);
  assert.equal(r.error, 'bad_host');
  // A loopback name on the wrong port is somebody else's service, not ours.
  assert.equal(decide(good({ host: '127.0.0.1:9999' })).error, 'bad_host');
});

test('a request with no token, or a wrong one, is refused', () => {
  const none = good();
  delete none.headers['x-interstice-token'];
  const r = decide(none);
  assert.equal(r.status, 401);
  assert.equal(r.error, 'unauthorized');
  assert.match(r.remedy, /x-interstice-token/, 'the refusal must name the remedy');

  assert.equal(decide(good({ 'x-interstice-token': 'b'.repeat(64) })).status, 401);
  // A prefix of the real token must not pass, and must not reveal that it is a prefix.
  assert.equal(decide(good({ 'x-interstice-token': TOKEN.slice(0, 32) })).status, 401);
});

test('reads are protected too, not only writes', () => {
  // A DNS-rebinding attacker reads responses; refusing only mutations would leave the gap open.
  const g = good();
  delete g.headers['x-interstice-token'];
  for (const p of ['/api/health', '/api/gaps', '/api/config', '/api/stars/month']) {
    assert.equal(decide({ ...g, method: 'GET' }, p).status, 401, `${p} must require the token`);
  }
});

test('only the page loads are exempt, because serving them is how the token is handed out', () => {
  for (const p of ['/', '/index.html', '/panel', '/debug', '/debug/']) {
    assert.equal(isTokenExempt(p), true);
    const g = good();
    delete g.headers['x-interstice-token'];
    assert.equal(decide({ ...g, method: 'GET' }, p), null);
  }
  assert.equal(isTokenExempt('/api/health'), false);
});

test('the token is 0600, generated not defaulted, and stable across reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-auth-'));
  const t1 = readOrCreateToken(dir);
  // literal-ok: 64 is the specification (32 random bytes rendered as hex), not a fixture size.
  assert.equal(t1.length, 64, 'a 32-byte token in hex');
  assert.equal(readOrCreateToken(dir), t1, 'a second call must not mint a new one');
  assert.equal(readToken(dir), t1);
  assert.equal(fs.statSync(tokenPath(dir)).mode & 0o777, 0o600);

  // Generated, so two installs never share a value the way a shipped default would.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-auth-'));
  assert.notEqual(readOrCreateToken(other), t1);
  assert.equal(readToken(fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-auth-'))), null);
});

test('comparison is constant time and total', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  // Different lengths must not throw: timingSafeEqual does, and that throw would be a length oracle.
  assert.equal(constantTimeEqual('a', 'aaaaaaaaaa'), false);
  assert.equal(constantTimeEqual(undefined, 'a'), false);
  assert.equal(constantTimeEqual('a', null), false);
});

test('the served page carries the token and wraps fetch once', () => {
  const out = injectToken('<html><head><title>x</title></head><body></body></html>', TOKEN);
  assert.match(out, /window\.__INTERSTICE_TOKEN="a{64}"/);
  assert.match(out, /x-interstice-token/);
  assert.ok(out.indexOf('__INTERSTICE_TOKEN') < out.indexOf('<title>'), 'must land in the head');
  // A page with no head still gets it, rather than silently shipping an unauthenticated page.
  assert.match(injectToken('<div>x</div>', TOKEN), /__INTERSTICE_TOKEN/);
});

/** Send a request over a raw socket, so headers fetch refuses to set (Host) actually go out. */
function rawRequest(port, requestLine, headers) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const lines = [requestLine, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', ''];
      sock.write(lines.join('\r\n'));
    });
    let out = '';
    sock.on('data', (d) => { out += d; });
    sock.on('end', () => resolve(out));
    sock.on('error', reject);
    sock.setTimeout(4000, () => { sock.destroy(); resolve(out); });
  });
}

// --- against a real server, over real sockets -------------------------------------------------

test('a real server refuses the live attack and serves the legitimate client', async (t) => {
  const { createServer } = await import('../lib/server.js');
  const { LOG_DIR } = await import('../lib/paths.js');
  const token = readOrCreateToken(LOG_DIR);

  // A port of its own, so this never collides with a daemon the operator is running.
  const port = 7519;
  const daemon = {
    health: () => ({ ok: true, pid: process.pid, counters: { gaps: 0 } }),
    panel: { state: () => ({ rung: null, seq: 0, detail: null }), ping() {} },
    focus: { status: () => ({ phase: 'idle', elapsedMs: 0 }) },
    latency: { active: () => [] },
    engine: { status: {} },
    stars: { starsForDay: () => [], starsForMonth: () => [] },
  };
  const srv = await createServer({ daemon, config: { port } });
  t.after(() => srv.close());

  const call = (pathname, headers = {}, method = 'GET') =>
    fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers });

  // The exact request the audit fired and got a 400 (the handler's own validation) rather than a
  // refusal. It must now be refused before any handler sees it.
  const attack = await fetch(`http://127.0.0.1:${port}/api/queued`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://evil.example' },
    body: JSON.stringify({ text: 'pwned' }),
  });
  assert.equal(attack.status, 403);
  assert.equal((await attack.json()).error, 'bad_origin');

  // And the rebinding shape, which previously returned 200. This one goes over a raw socket:
  // Host is a forbidden header for fetch, so undici silently rewrites it and the request under
  // test never leaves the process. A test that cannot send the attack cannot prove it is refused.
  const rebound = await rawRequest(port, 'GET /api/health HTTP/1.1', {
    host: 'attacker.example',
    'x-interstice-token': token,
  });
  assert.match(rebound, /^HTTP\/1\.1 403/, `expected 403, got: ${rebound.slice(0, 40)}`);
  assert.match(rebound, /bad_host/);

  // No token at all.
  assert.equal((await call('/api/health')).status, 401);

  // The legitimate local client, which proves it is local by reading the 0600 token file.
  const ok = await call('/api/health', { 'x-interstice-token': token });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);

  // The panel is served without a token, and carries one, which is how a browser gets it.
  const page = await call('/panel');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /window\.__INTERSTICE_TOKEN/);
  assert.ok(html.includes(token), 'the served page must carry the running daemon\'s token');
});
