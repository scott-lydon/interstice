import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatency, latencyEventFromEngine } from '../lib/latency.js';
import { classify } from '../lib/transcript.js';

const t = (ms) => new Date(Date.parse('2026-08-19T09:00:00-07:00') + ms).toISOString();

test('elapsed grows while waiting and is null before a submit (5.1)', () => {
  const l = createLatency();
  assert.equal(l.elapsedMs('s1', t(0)), null, 'no timer before submit');
  l.onSubmit({ sessionId: 's1', at: t(0) });
  assert.equal(l.elapsedMs('s1', t(3000)), 3000);
  assert.equal(l.elapsedMs('s1', t(9000)), 9000);
});

test('completion clears the timer and returns a delivery record (5.3)', () => {
  const l = createLatency();
  l.onSubmit({ sessionId: 's1', at: t(0) });
  const rec = l.onComplete({ sessionId: 's1', at: t(4200) });
  assert.deepEqual(rec, { sessionId: 's1', submittedAt: t(0), arrivedAt: t(4200), elapsedMs: 4200 });
  assert.equal(l.isWaiting('s1'), false, 'no longer waiting');
  assert.equal(l.elapsedMs('s1', t(9000)), null, 'cleared, not frozen');
});

test('a completion with no matching submit returns null (no phantom notification)', () => {
  const l = createLatency();
  assert.equal(l.onComplete({ sessionId: 'ghost', at: t(1) }), null);
});

test('two concurrent sessions do not collide; completing one clears only that one (5.6)', () => {
  const l = createLatency();
  l.onSubmit({ sessionId: 'a', at: t(0) });
  l.onSubmit({ sessionId: 'b', at: t(1000) });
  l.onComplete({ sessionId: 'a', at: t(5000) });
  assert.equal(l.isWaiting('a'), false);
  assert.equal(l.isWaiting('b'), true, "b's timer is untouched");
  assert.equal(l.elapsedMs('b', t(6000)), 5000);
});

test('a Cowork-shaped and a Claude-Code-shaped event drive identical behaviour (5.5)', () => {
  // The two surfaces produce genuinely different raw events. Cowork's watcher classifies a
  // JSONL prompt line; Claude Code's UserPromptSubmit hook appends a one-line record. Both are
  // fed through the single adapter and must drive byte-identical downstream behaviour.
  const base = Date.parse('2026-08-19T09:00:00-07:00');

  // Cowork: a real human-submit transcript line, classified by the shipping classifier.
  const coworkLine = JSON.stringify({ type: 'user', sessionId: 'cw', timestamp: new Date(base).toISOString(), message: { content: 'summarise this chapter' } });
  const coworkEngineEv = classify(coworkLine, { surface: 'cowork', file: 'x.jsonl' });
  assert.equal(coworkEngineEv.event, 'submit');
  assert.equal(coworkEngineEv.surface, 'cowork');

  // Claude Code: the exact line hooks/on-submit.sh appends.
  const hookLine = `{"event":"submit","surface":"claude-code","sessionId":"cc","ts":${base},"via":"hook"}`;
  const claudeEngineEv = JSON.parse(hookLine);
  assert.equal(claudeEngineEv.surface, 'claude-code');

  const cowork = createLatency();
  const claude = createLatency();
  cowork.onSubmit(latencyEventFromEngine(coworkEngineEv));
  claude.onSubmit(latencyEventFromEngine(claudeEngineEv));

  // identical elapsed while waiting
  assert.equal(cowork.elapsedMs('cw', t(2000)), claude.elapsedMs('cc', t(2000)));
  // identical completion behaviour: same elapsed, both cleared, neither frozen
  const cwRec = cowork.onComplete({ sessionId: 'cw', at: t(4200) });
  const ccRec = claude.onComplete({ sessionId: 'cc', at: t(4200) });
  assert.equal(cwRec.elapsedMs, ccRec.elapsedMs, 'identical elapsed downstream');
  assert.equal(cowork.isWaiting('cw'), claude.isWaiting('cc'));
  assert.equal(cowork.elapsedMs('cw', t(9000)), claude.elapsedMs('cc', t(9000)));
});
