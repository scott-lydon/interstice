import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starsHandler } from '../lib/focus/stars-routes.js';

// 3.10: an HTTP test hits each new star route and asserts shape and status codes, including the
// error shape for a malformed date range. A tiny server wraps the same handler the real routes use.
const store = {
  starsForDay: (d) => (d === '2026-08-19' ? [{ id: 'a', startedAt: '2026-08-19T09:00:00-07:00', endedAt: '2026-08-19T09:25:00-07:00', day: d }] : []),
  starsForMonth: (m) => (m === '2026-08' ? [{ id: 'a', startedAt: '2026-08-19T09:00:00-07:00', endedAt: '2026-08-19T09:25:00-07:00', day: '2026-08-19' }] : []),
};

function serve() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let r;
    if (url.pathname === '/api/stars/day') r = starsHandler(store, 'day', url.searchParams.get('day'));
    else if (url.pathname === '/api/stars/month') r = starsHandler(store, 'month', url.searchParams.get('month'));
    else r = { status: 404, body: { error: 'not_found' } };
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
}

async function get(server, path) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

test('the star routes answer with the right shape, status, and error', async () => {
  const server = serve();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const day = await get(server, '/api/stars/day?day=2026-08-19');
    assert.equal(day.status, 200);
    assert.equal(day.body.day, '2026-08-19');
    assert.equal(day.body.stars.length, 1);
    assert.equal(day.body.stars[0].startedAt, '2026-08-19T09:00:00-07:00');

    const month = await get(server, '/api/stars/month?month=2026-08');
    assert.equal(month.status, 200);
    assert.equal(month.body.stars.length, 1);

    const emptyDay = await get(server, '/api/stars/day?day=2020-01-01');
    assert.equal(emptyDay.status, 200);
    assert.deepEqual(emptyDay.body.stars, [], 'an empty day is an empty list, not an error');

    const bad = await get(server, '/api/stars/day?day=not-a-date');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad_date');
    assert.match(bad.body.detail, /YYYY-MM-DD/);

    const badMonth = await get(server, '/api/stars/month?month=2026');
    assert.equal(badMonth.status, 400);
    assert.equal(badMonth.body.error, 'bad_date');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
