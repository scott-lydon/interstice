import crypto from 'node:crypto';
import { readJsonl, appendJsonl } from './logger.js';
import { TODO_STATE } from './paths.js';

/**
 * What is done, and what is not.
 *
 * Completion is tracked here rather than written back into Notes, and that is a
 * deliberate limit rather than a shortcut. Notes' scripting interface can only
 * replace a note's entire `body` HTML; there is no "tick this one item". Ticking a
 * box would mean regenerating the whole note from our parse of it, and our parse is
 * lossy by design (it keeps text and nesting, and drops images, links, tables,
 * attachments and formatting). One tick would quietly flatten the note. Your notes
 * are the input to this rung and are never the thing it edits.
 *
 * Items are keyed by note and text, not by position. Positions move every time you
 * add a line above; the text is what you actually recognise, and keying on it means
 * a finished item stays finished when the list is reordered.
 */

export function itemKey({ noteId, text, depth = 1 }) {
  const norm = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha1').update(`${noteId}|${depth}|${norm}`).digest('hex').slice(0, 16);
}

/** Latest write wins, so a toggle is just another append. */
export function readOverrides() {
  const out = new Map();
  for (const row of readJsonl(TODO_STATE)) {
    if (row?.key) out.set(row.key, row);
  }
  return out;
}

export function setDone({ key, done, noteId = null, text = null }) {
  const record = { ts: Date.now(), key, done: Boolean(done), noteId, text };
  appendJsonl(TODO_STATE, record);
  return record;
}

/**
 * Merge what the note says with what you have ticked here.
 *
 * A local decision wins over the note's own checkbox, because it is always the more
 * recent statement: the note's markers were written before this rung existed.
 */
export function applyOverrides(lists, overrides = readOverrides()) {
  return lists.map((list) => {
    const items = list.items.map((item) => {
      const key = itemKey(item);
      const override = overrides.get(key);
      return {
        ...item,
        key,
        done: override ? override.done : item.doneInNote,
        source: override ? 'interstice' : item.doneInNote ? 'note' : 'open',
        doneAt: override?.done ? override.ts : null,
      };
    });
    const done = items.filter((i) => i.done).length;
    return { ...list, items, counts: { total: items.length, done, open: items.length - done } };
  });
}

/** Rolled up for the router: is there anything left to do? */
export function openCount(lists) {
  return lists.reduce((n, l) => n + (l.counts?.open ?? 0), 0);
}
