/**
 * Transcript line classification.
 *
 * Both Cowork and Claude Code write the same append-only JSONL format. The
 * discriminators below were derived by inspecting real transcripts, not guessed,
 * because the obvious reading of the format is wrong in one important way:
 *
 *   Tool results are recorded as `type: "user"` lines.
 *
 * Counting those as prompts inflates the turn count by roughly 4x and drags the
 * apparent median turn length from ~4 minutes down to ~7 seconds. A real human
 * submit has string content and no `toolUseResult`; a tool result has an array of
 * `tool_result` blocks and carries `toolUseResult`.
 *
 * End of turn is equally specific: assistant lines carry `stop_reason: "tool_use"`
 * for every mid-turn step. Only `end_turn` and `stop_sequence` mean the agent has
 * actually stopped and is waiting on you.
 */

export const TURN_END_STOP_REASONS = new Set(['end_turn', 'stop_sequence']);

/** True when this line is a genuine human prompt submission. */
export function isHumanSubmit(d) {
  if (!d || d.type !== 'user') return false;
  if (d.isSidechain) return false; // subagent traffic, not you
  if (d.isMeta) return false; // system-injected context
  if ('toolUseResult' in d) return false; // tool result wearing a user costume
  const content = d.message?.content;
  return typeof content === 'string';
}

/** True when this line marks the agent finishing its turn. */
export function isTurnEnd(d) {
  if (!d || d.type !== 'assistant') return false;
  if (d.isSidechain) return false;
  return TURN_END_STOP_REASONS.has(d.message?.stop_reason);
}

/**
 * True when the agent is blocked waiting for a permission decision. Treated the
 * same as a turn end: either way the agent has stopped and wants you back.
 */
export function isPermissionRequest(d) {
  if (!d) return false;
  if (d.type === 'user' && d.toolDenialKind) return true;
  return d.type === 'permission-request';
}

export function parseLine(line) {
  const s = line.trim();
  if (!s || s[0] !== '{') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null; // a partially flushed write; the next event re-reads from our offset
  }
}

/**
 * Classify one raw JSONL line into a domain event, or null if uninteresting.
 * `surface` is attached by the caller so both watchers emit the same shape.
 */
export function classify(line, { surface, file }) {
  const d = parseLine(line);
  if (!d) return null;
  const ts = d.timestamp ? Date.parse(d.timestamp) : Date.now();
  const sessionId = d.sessionId || d.session_id || null;

  if (isHumanSubmit(d)) {
    return {
      event: 'submit',
      surface,
      sessionId,
      promptId: d.promptId || null,
      cwd: d.cwd || null,
      ts,
      file,
    };
  }
  if (isPermissionRequest(d)) {
    return { event: 'end', reason: 'permission', surface, sessionId, ts, file };
  }
  if (isTurnEnd(d)) {
    return { event: 'end', reason: 'complete', surface, sessionId, ts, file };
  }
  return null;
}
