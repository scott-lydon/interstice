import test from 'node:test';
import assert from 'node:assert/strict';
import { probeVideo, toVideoRecords, PLAYING_EXPRESSION } from '../lib/video/probe.js';

// A fake CDP session driven by a fixture, recording every method it is asked to send.
//
// It models the real protocol, which the previous version of this stub did not: `Target.getTargets`
// returns target INFOS with no sessionId, and a session only exists after `Target.attachToTarget`.
// The old stub handed back a sessionId from getTargets and matched on it, so it agreed with a
// version of the probe that could not work against a real browser, and the whole suite stayed green
// while the video breaker detected nothing at all. A stub that invents a protocol tests the stub.
function fakeSession({ targets, playingByTarget = {} }) {
  const calls = [];
  const attached = new Map(); // sessionId -> target
  let next = 0;
  return {
    calls,
    async send(method, params, sessionId) {
      calls.push(method);
      if (method === 'Target.getTargets') {
        // Deliberately strip sessionId: the real browser does not send one here.
        return { targetInfos: targets.map(({ sessionId: _drop, ...rest }) => rest) };
      }
      if (method === 'Target.attachToTarget') {
        const t = targets.find((x) => x.targetId === params.targetId);
        if (!t) throw new Error(`no such target ${params.targetId}`);
        const sid = `attached-${++next}`;
        attached.set(sid, t);
        return { sessionId: sid };
      }
      if (method === 'Target.detachFromTarget') {
        attached.delete(params.sessionId);
        return {};
      }
      if (method === 'Runtime.evaluate') {
        const t = attached.get(sessionId);
        // What a real browser does when you evaluate without attaching first.
        if (!t) throw new Error("'Runtime.evaluate' wasn't found");
        return { result: { value: !!playingByTarget[t.url] } };
      }
      return {};
    },
    close() { calls.push('close'); },
  };
}

test('a playing video is reported with playing:true; a paused one false; a medialess tab none', async () => {
  const targets = [
    { type: 'page', targetId: 't1', url: 'https://youtube.com/watch', sessionId: 's1' },
    { type: 'page', targetId: 't2', url: 'https://udemy.com/course', sessionId: 's2' },
    { type: 'page', targetId: 't3', url: 'https://example.com/text', sessionId: 's3' },
  ];
  const session = fakeSession({ targets, playingByTarget: { 'https://youtube.com/watch': true, 'https://udemy.com/course': false } });
  const records = await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://x' }], connect: async () => session });
  const yt = records.find((r) => r.host === 'youtube.com');
  const ud = records.find((r) => r.host === 'udemy.com');
  assert.equal(yt.playing, true);
  assert.equal(ud.playing, false);
  assert.equal(records.length, targets.length, 'the medialess tab is reported as not playing, still a record');
});

test('the probe is read-only: no navigation, activation, or tab creation', async () => {
  const targets = [{ type: 'page', targetId: 't1', url: 'https://youtube.com/x', sessionId: 's1' }];
  const session = fakeSession({ targets, playingByTarget: { 'https://youtube.com/x': true } });
  await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://x' }], connect: async () => session });
  const mutating = ['Page.navigate', 'Target.activateTarget', 'Target.createTarget', 'Target.closeTarget'];
  for (const m of mutating) assert.ok(!session.calls.includes(m), `the probe must not call ${m}`);
});

test('no reachable browser launches nothing and returns an empty list', async () => {
  const records = await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://dead' }], connect: async () => { throw new Error('refused'); } });
  assert.deepEqual(records, []);
});

test('the playing expression checks real play state, not merely an open tab', () => {
  assert.match(PLAYING_EXPRESSION, /!m\.paused/);
  assert.match(PLAYING_EXPRESSION, /currentTime > 0/);
});
