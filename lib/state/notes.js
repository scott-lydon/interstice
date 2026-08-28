import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TODO_CACHE } from '../paths.js';
import { isRunning } from './system.js';

const run = promisify(execFile);

/**
 * Your to-do lists, read out of Notes without Notes ever appearing.
 *
 * Two things make this viable rather than merely possible.
 *
 * The store itself is unreadable: `~/Library/Group Containers/group.com.apple.notes`
 * is TCC protected and returns "Operation not permitted" to a plain file read, so
 * parsing NoteStore.sqlite directly would need Full Disk Access. Scripting the app
 * needs only the Automation grant, which is already in place.
 *
 * And it has to be asked the right way. Reading `id`, `name` and `modification date`
 * one note at a time is one Apple event per property per note: timed once against a real
 * library, that took 104 seconds for the first 40 notes alone. Asking for `a.notes.id()`
 * gets every id in a single event, and the whole library came back in about 0.3s on that
 * same reading. Same data, a fraction of a second instead of minutes.
 *
 * Nothing here activates Notes, nothing here starts it, and nothing here writes to
 * it. Completion is tracked on our side (see todo-store.js) precisely so that your
 * notes are never edited.
 *
 * Not starting it is the part that took a while to get right. An earlier version
 * launched Notes hidden with `open -g -j` before each read, on the theory that a
 * hidden app is not an interruption. It is: quitting Notes got it back inside
 * twenty seconds, every state poll, because the poll runs while you work. Hidden or
 * not, an app you closed that reappears in your Dock and your app switcher is an
 * app this project opened. So the read is now conditional on Notes already being
 * up, and when it is not the lists come from the cache below.
 */

const LIST_SCRIPT = `
const N = Application("Notes");
const a = N.defaultAccount();
const ids = a.notes.id(), names = a.notes.name(), dates = a.notes.modificationDate();
JSON.stringify(ids.map((id, i) => ({
  id,
  name: names[i] || "",
  modified: dates[i] ? dates[i].getTime() : 0,
})));
`;

/*
 * Whether Notes is yours to read right now.
 *
 * Sending an Apple event to an app that is not running starts it, so every read
 * has to be gated on this rather than on the event failing. `isRunning` asks
 * through the bundle and starts nothing.
 */

/** Thrown when Notes is not running, so no Apple event is sent that would start it. */
export class NotesClosed extends Error {
  constructor() {
    super('notes_not_running');
    this.name = 'NotesClosed';
  }
}

async function osa(script, { timeoutMs = 15000 } = {}) {
  if (!(await isRunning('Notes'))) throw new NotesClosed();
  const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

export async function listNotes({ timeoutMs = 15000 } = {}) {
  return (await osa(LIST_SCRIPT, { timeoutMs })) ?? [];
}

export async function noteBodies(ids, { timeoutMs = 20000 } = {}) {
  if (!ids.length) return {};
  const script = `
    const N = Application("Notes");
    const want = ${JSON.stringify(ids)};
    const out = {};
    for (const id of want) {
      try { out[id] = N.notes.byId(id).body(); } catch (e) { out[id] = null; }
    }
    JSON.stringify(out);
  `;
  return (await osa(script, { timeoutMs })) ?? {};
}

/**
 * Which notes are to-do lists.
 *
 * Title evidence is weighted above body evidence on purpose. A note *called* "ToDO"
 * is a to-do list even if it is currently one line, whereas a note that merely
 * contains a bulleted list is usually a transcript, a quote, or notes from a call.
 * Getting that backwards fills the rung with things you were never going to do.
 */
const TITLE_MARKER = /\b(to\s*-?\s*do|todo|to\s*dos|checklist|task list|tasks|packing|shopping)\b/i;
// A bracket at the start of an item is a checkbox whether or not a bullet precedes
// it. Requiring the dash missed every list written the way people actually write
// one, `[ ] thing`, and those are the lists this rung is for.
const BODY_MARKER = /(?:^|[\n>])\s*-?\s*\[[ xX]\]|class="checklist"/;

/**
 * A bulleted list is worth a point and never enough on its own. Most notes with
 * bullets are transcripts, quotes, or notes from a call, and a rung filled with
 * those is a rung full of things you were never going to do. Qualifying takes real
 * evidence: a title that says so, or boxes that are waiting to be ticked.
 */
export const QUALIFIES = 6;

export function scoreNote(note, body) {
  let score = 0;
  if (TITLE_MARKER.test(note.name)) score += 10;
  if (body && BODY_MARKER.test(body)) score += 6;
  if (body && /<li>/i.test(body)) score += 1;
  return score;
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&quot': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function decode(html) {
  return String(html)
    .replace(/&#(\d+);?/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;?/gi, (e) => (e in ENTITIES ? ENTITIES[e] : e));
}

/**
 * Turn a Notes body into a flat list of items that remembers its own nesting.
 *
 * Notes emits ordinary `<ul>/<li>`, and nests by opening a `<ul>` *between* two
 * `<li>` elements rather than inside one, so depth has to be tracked from the tag
 * stream rather than read off the tree. Markdown checkboxes are honoured too,
 * because half of these lists were pasted in from somewhere that used them.
 */
export function parseBody(html, { noteId = '', maxItems = 200 } = {}) {
  if (!html) return [];
  const items = [];
  let depth = 0;
  let open = null; // the item currently collecting text

  const tokens = String(html).match(/<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (token[0] !== '<') {
      // Text only counts while a list item is open. Notes puts prose in sibling
      // `<div>` blocks between lists, and without this it lands on whichever item
      // happened to come before it.
      if (open) open.text += decode(token);
      continue;
    }
    if (/^<(ul|ol)\b/i.test(token)) {
      depth += 1;
      continue;
    }
    if (/^<\/(ul|ol)>/i.test(token)) {
      depth = Math.max(0, depth - 1);
      open = null;
      continue;
    }
    if (/^<li\b/i.test(token)) {
      if (items.length >= maxItems) {
        open = null;
        continue;
      }
      open = {
        depth: Math.max(1, depth),
        index: items.length,
        text: '',
        checkedInNote: /\bchecked\b|data-checked="true"/i.test(token),
      };
      items.push(open);
      continue;
    }
    // A nested list closes the parent item's text run; a <br> does not.
    if (/^<\/li>/i.test(token) || /^<(div|h[1-6])\b/i.test(token)) open = null;
  }

  return items
    .map((it) => {
      const raw = it.text.replace(/\s+/g, ' ').trim();
      const md = raw.match(/^-?\s*\[([ xX])\]\s*(.*)$/);
      return {
        noteId,
        depth: it.depth,
        index: it.index,
        text: md ? md[2].trim() : raw,
        doneInNote: it.checkedInNote || (md ? md[1].toLowerCase() === 'x' : false),
      };
    })
    .filter((it) => it.text.length > 0);
}

/**
 * The most recent to-do lists, with their items.
 *
 * Bodies cost one Apple event each and the collection is in the thousands, so only
 * a shortlist is ever opened. The shortlist is drawn two ways, and it needs both.
 *
 * Titles find the lists you keep. Recency finds the list you started ten minutes
 * ago and called something else. Screening on the title alone quietly loses the
 * second kind forever: `scoreNote` is willing to qualify a note on its checkboxes,
 * but a note that never made the shortlist never has its body read, so that willing-
 * ness never gets a chance to matter. A note headed `interstice:` and full of `[ ]`
 * lines is exactly the note you most want on this rung, and it scored nothing at all
 * because of its heading.
 */
export async function scrapeTodoLists(config = {}, { timeoutMs = 20000 } = {}) {
  const maxLists = config.todo?.maxLists ?? 3;
  const maxItems = config.todo?.maxItemsPerList ?? 200;

  let notes;
  try {
    notes = await listNotes({ timeoutMs });
  } catch (err) {
    // Notes being closed is the ordinary case, not a fault: the rung falls back to
    // the last lists it was given rather than starting an app to refresh them.
    if (err instanceof NotesClosed) return recallTodoLists();
    return { available: false, reason: `notes_unreadable: ${err.message}`, lists: [] };
  }
  if (!notes.length) return { available: false, reason: 'no_notes', lists: [] };

  notes.sort((a, b) => b.modified - a.modified);

  // Notes arrive newest first, so "the latest notes" is simply the front of the list.
  const recentScan = config.todo?.scanRecent ?? 12;
  const byTitle = notes.filter((n) => TITLE_MARKER.test(n.name)).slice(0, maxLists * 2);
  const byRecency = notes.slice(0, recentScan);
  const candidates = [];
  const seen = new Set();
  for (const n of [...byTitle, ...byRecency]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    candidates.push(n);
  }
  if (!candidates.length) return { available: false, reason: 'no_todo_lists', lists: [] };

  let bodies = {};
  try {
    bodies = await noteBodies(candidates.map((n) => n.id), { timeoutMs });
  } catch (err) {
    if (err instanceof NotesClosed) return recallTodoLists();
    return { available: false, reason: `bodies_unreadable: ${err.message}`, lists: [] };
  }

  const lists = candidates
    .map((n) => ({ ...n, score: scoreNote(n, bodies[n.id]), body: bodies[n.id] }))
    .filter((n) => n.score >= QUALIFIES)
    .sort((a, b) => b.modified - a.modified)
    .slice(0, maxLists)
    .map((n) => ({
      id: n.id,
      title: n.name,
      modified: n.modified,
      items: parseBody(n.body, { noteId: n.id, maxItems }),
    }))
    .filter((l) => l.items.length > 0);

  const result = {
    available: lists.length > 0,
    reason: lists.length ? 'lists_found' : 'lists_empty',
    scanned: notes.length,
    lists,
  };
  if (lists.length) rememberTodoLists(result);
  return result;
}

/**
 * The lists as of the last time Notes was open.
 *
 * Serving these is honest rather than merely convenient: the items are read-only
 * here, ticking is recorded on our side, and the panel says when the copy is from.
 * The alternative is starting Notes to refresh them, which is the behaviour this
 * cache exists to make unnecessary.
 */
function rememberTodoLists({ lists, scanned }) {
  try {
    fs.writeFileSync(TODO_CACHE, JSON.stringify({ at: Date.now(), scanned, lists }, null, 2));
  } catch {
    /* the cache is a courtesy; failing to write it must not fail the read */
  }
}

export function recallTodoLists() {
  try {
    const c = JSON.parse(fs.readFileSync(TODO_CACHE, 'utf8'));
    if (!Array.isArray(c.lists) || !c.lists.length) throw new Error('empty');
    return {
      available: true,
      reason: 'notes_closed_using_cache',
      scanned: c.scanned ?? 0,
      cachedAt: c.at ?? null,
      lists: c.lists,
    };
  } catch {
    return { available: false, reason: 'notes_not_running', lists: [] };
  }
}
