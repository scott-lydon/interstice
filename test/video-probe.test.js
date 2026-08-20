import test from 'node:test';
import assert from 'node:assert/strict';
import { probeVideo, toVideoRecords, PLAYING_EXPRESSION } from '../lib/video/probe.js';

// A fake CDP session driven by a fixture, recording every method it is asked to send.
function fakeSession({ targets, playingByTarget = {} }) {
  const calls = [];
  return {
    calls,
    async send(method, params, sessionId) {
      calls.push(method);
      if (method === 'Target.getTargets') return { targetInfos: targets };
      if (method === 'Runtime.evaluate') {
        const t = targets.find((x) => x.sessionId === sessionId);
        return { result: { value: !!playingByTarget[t?.url] } };
      }
      return {};
    },
    close() { calls.push('close'); },
  };
}

test('a playing video is reported with playing:true; a paused one false; a medialess tab none', async () => {
  const targets = [
    { type: 'page', url: 'https://youtube.com/watch', sessionId: 's1' },
    { type: 'page', url: 'https://udemy.com/course', sessionId: 's2' },
    { type: 'page', url: 'https://example.com/text', sessionId: 's3' },
  ];
  const session = fakeSession({ targets, playingByTarget: { 'https://youtube.com/watch': true, 'https://udemy.com/course': false } });
  const records = await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://x' }], connect: async () => session });
  const yt = records.find((r) => r.host === 'youtube.com');
  const ud = records.find((r) => r.host === 'udemy.com');
  assert.equal(yt.playing, true);
  assert.equal(ud.playing, false);
  assert.equal(records.length, targets.length, 'the medialess tab is reported as not playing, still a record');
});

test('the probe is read-only: no navigation, activation, or tab creation (4.2)', async () => {
  const targets = [{ type: 'page', url: 'https://youtube.com/x', sessionId: 's1' }];
  const session = fakeSession({ targets, playingByTarget: { 'https://youtube.com/x': true } });
  await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://x' }], connect: async () => session });
  const mutating = ['Page.navigate', 'Target.activateTarget', 'Target.createTarget', 'Target.closeTarget'];
  for (const m of mutating) assert.ok(!session.calls.includes(m), `the probe must not call ${m}`);
});

test('no reachable browser launches nothing and returns an empty list (4.2)', async () => {
  const records = await probeVideo({ browsers: [{ name: 'Chrome', wsUrl: 'ws://dead' }], connect: async () => { throw new Error('refused'); } });
  assert.deepEqual(records, []);
});

test('the playing expression checks real play state, not merely an open tab', () => {
  assert.match(PLAYING_EXPRESSION, /!m\.paused/);
  assert.match(PLAYING_EXPRESSION, /currentTime > 0/);
});
