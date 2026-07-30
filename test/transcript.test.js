import test from 'node:test';
import assert from 'node:assert/strict';
import { isHumanSubmit, isTurnEnd, classify } from '../lib/transcript.js';

const humanSubmit = {
  type: 'user',
  message: { role: 'user', content: 'go build the thing' },
  promptId: 'p1',
  sessionId: 's1',
  timestamp: '2026-07-30T19:35:05.551Z',
};

// The trap: tool results are recorded as type "user".
const toolResult = {
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
  toolUseResult: { stdout: 'ok' },
  promptId: 'p1',
  sessionId: 's1',
  timestamp: '2026-07-30T19:35:09.000Z',
};

const midTurn = {
  type: 'assistant',
  message: { stop_reason: 'tool_use', content: [{ type: 'tool_use' }] },
  sessionId: 's1',
  timestamp: '2026-07-30T19:35:10.000Z',
};

const endTurn = {
  type: 'assistant',
  message: { stop_reason: 'end_turn', content: [{ type: 'text' }] },
  sessionId: 's1',
  timestamp: '2026-07-30T19:39:10.000Z',
};

test('a genuine human prompt is a submit', () => {
  assert.equal(isHumanSubmit(humanSubmit), true);
});

test('a tool result is NOT a submit even though its type is "user"', () => {
  assert.equal(isHumanSubmit(toolResult), false);
});

test('subagent and meta lines are not submits', () => {
  assert.equal(isHumanSubmit({ ...humanSubmit, isSidechain: true }), false);
  assert.equal(isHumanSubmit({ ...humanSubmit, isMeta: true }), false);
});

test('stop_reason tool_use is mid-turn, not the end', () => {
  assert.equal(isTurnEnd(midTurn), false);
});

test('stop_reason end_turn and stop_sequence end the turn', () => {
  assert.equal(isTurnEnd(endTurn), true);
  assert.equal(isTurnEnd({ ...endTurn, message: { stop_reason: 'stop_sequence' } }), true);
});

test('a subagent finishing does not end your turn', () => {
  assert.equal(isTurnEnd({ ...endTurn, isSidechain: true }), false);
});

test('classify maps lines to domain events with a surface', () => {
  const sub = classify(JSON.stringify(humanSubmit), { surface: 'cowork', file: '/x.jsonl' });
  assert.equal(sub.event, 'submit');
  assert.equal(sub.surface, 'cowork');
  assert.equal(sub.promptId, 'p1');
  assert.equal(sub.ts, Date.parse(humanSubmit.timestamp));

  const end = classify(JSON.stringify(endTurn), { surface: 'cowork', file: '/x.jsonl' });
  assert.equal(end.event, 'end');
  assert.equal(end.reason, 'complete');

  assert.equal(classify(JSON.stringify(toolResult), { surface: 'cowork', file: '/x' }), null);
  assert.equal(classify(JSON.stringify(midTurn), { surface: 'cowork', file: '/x' }), null);
});

test('a half-written line is ignored rather than throwing', () => {
  assert.equal(classify('{"type":"user","mess', { surface: 'cowork', file: '/x' }), null);
  assert.equal(classify('', { surface: 'cowork', file: '/x' }), null);
  assert.equal(classify('not json at all', { surface: 'cowork', file: '/x' }), null);
});
