import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, appendJsonl } from './logger.js';
import { GAPS_LOG, EVENTS_LOG, ROOT, QUEUED_PROMPTS } from './paths.js';
import { summarize } from './stats.js';

/**
 * Local control surface and dashboard. Binds to loopback only.
 *
 * The /debug routes exist because most interesting states are slow to reach by
 * hand: you cannot conjure a 12 minute agent turn on demand, and waiting for one
 * makes every iteration cost twelve minutes. Anything driven from /debug is tagged
 * `synthetic: true` and excluded from the statistics, so the debug surface can
 * never quietly inflate the numbers it is sitting next to.
 */

const json = (res, code, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export async function createServer({ daemon, config }) {
  const routes = {
    'GET /api/health': (req, res) => json(res, 200, daemon.health()),

    'GET /api/status': (req, res) => json(res, 200, daemon.engine.status),

    'GET /api/gaps': (req, res, url) => {
      const limit = Number(url.searchParams.get('limit') || 500);
      const all = readJsonl(GAPS_LOG);
      json(res, 200, { count: all.length, gaps: all.slice(-limit) });
    },

    'GET /api/stats': (req, res) => {
      const gaps = readJsonl(GAPS_LOG);
      json(res, 200, summarize(gaps, config));
    },

    'GET /api/events': (req, res, url) => {
      const limit = Number(url.searchParams.get('limit') || 200);
      const gapId = url.searchParams.get('gapId');
      let all = readJsonl(EVENTS_LOG);
      if (gapId) all = all.filter((e) => e.gapId === gapId);
      json(res, 200, { events: all.slice(-limit) });
    },

    'GET /api/config': (req, res) => json(res, 200, config),

    'GET /api/queued': (req, res) => {
      const queued = readJsonl(QUEUED_PROMPTS).filter((q) => q.text);
      json(res, 200, { count: queued.length, queued: queued.slice(-50) });
    },

    'POST /api/queued': async (req, res) => {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { ok: false, error: 'empty' });
      const record = { ts: Date.now(), event: 'queued', text };
      appendJsonl(QUEUED_PROMPTS, record);
      json(res, 200, { ok: true, record });
    },

    'POST /api/advance': async (req, res) => json(res, 200, await daemon.engine.advance()),

    'POST /api/standdown': async (req, res) => {
      const body = await readBody(req);
      json(res, 200, daemon.engine.standDown({ forDay: Boolean(body.day) }));
    },

    // ---- debug: drive the machine into states the happy path cannot reach ----

    'POST /debug/submit': async (req, res) => {
      const body = await readBody(req);
      const gap = daemon.engine.onSubmit({
        surface: body.surface || 'debug',
        ts: Date.now(),
        synthetic: true,
      });
      json(res, 200, { ok: true, gapId: gap.id });
    },

    'POST /debug/rung': async (req, res) => {
      const body = await readBody(req);
      if (!daemon.engine.gap) return json(res, 409, { ok: false, error: 'no open gap' });
      const r = await daemon.engine.advance();
      json(res, 200, r);
    },

    'POST /debug/end': async (req, res) => {
      const body = await readBody(req);
      const rec = await daemon.engine.onEnd({ reason: body.reason || 'complete' });
      json(res, 200, { ok: true, gap: rec });
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);
    const key = `${req.method} ${url.pathname}`;

    try {
      if (routes[key]) return await routes[key](req, res, url);

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return serveFile(res, path.join(ROOT, 'web', 'dashboard.html'), 'text/html');
      }
      if (url.pathname === '/capture') {
        return serveFile(res, path.join(ROOT, 'web', 'capture.html'), 'text/html');
      }
      if (url.pathname === '/debug' || url.pathname === '/debug/') {
        return serveFile(res, path.join(ROOT, 'web', 'debug.html'), 'text/html');
      }
      json(res, 404, { error: 'not found', path: url.pathname });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  function serveFile(res, file, type) {
    if (!fs.existsSync(file)) return json(res, 404, { error: `missing ${path.basename(file)}` });
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only. Nothing here should ever be reachable from the network.
    server.listen(config.port, '127.0.0.1', resolve);
  });

  return {
    server,
    port: config.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
