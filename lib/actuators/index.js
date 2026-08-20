import * as anki from '../state/anki.js';
import { launchHeadless } from '../state/system.js';
import { kindleState } from '../state/kindle.js';
import { scrapeTodoLists } from '../state/notes.js';
import { applyOverrides, openCount } from '../todo-store.js';

/**
 * Actuators put an activity in front of you.
 *
 * Two hard rules, both enforced by a test that greps this directory.
 *
 * Nothing is ever quit or closed, and the only thing ever hidden is an Anki this tool started
 * itself. Delivery only ever changes which window
 * is in front, so your Cowork window keeps its exact state and stays one keystroke
 * behind.
 *
 * And nothing raises a third-party app. Anki, Kindle and Notes are read over their
 * own interfaces and rendered in the panel; no actuator raises one. The first
 * build activated each one in turn, and the operator's own to-do list recorded the
 * verdict on it: "it just pops up instead of streaming into one interface". Four
 * apps taking focus in sequence is four interruptions, which is the problem this
 * project exists to remove, not a way of solving it.
 *
 * Every actuator returns {ok, detail} and throws only on genuine failure, so the
 * engine can fall through to the next rung rather than leaving you with nothing.
 */

async function flashcards(config, ctx) {
  // Anki has to be running for AnkiConnect to answer, but it does not have to be
  // seen. `open -g` starts it behind everything; if it is already up this changes
  // nothing at all.
  await launchHeadless('Anki');
  const queue = await anki.leastStudiedQueue(config);
  if (!queue.deck) throw new Error(`no deck has cards due (${queue.reason})`);

  await ctx.panel.show('flashcards', {
    deck: queue.deck,
    due: queue.metric.due,
    meanReps: queue.metric.meanReps,
  });

  return {
    ok: true,
    detail: {
      deck: queue.deck,
      chosenBy: 'least_studied',
      meanReps: queue.metric.meanReps,
      due: queue.metric.due,
      decksWithDue: queue.metric.decksWithDue,
      queued: queue.cards.length,
    },
  };
}

async function reading(config, ctx) {
  const state = await kindleState(config);
  if (!state.available) throw new Error(`reading unavailable: ${state.reason}`);
  if (!state.book) throw new Error(`reading unavailable: ${state.reason}`);

  await ctx.panel.show('reading', { title: state.book.title, percent: state.book.percent });

  return {
    ok: true,
    detail: {
      app: state.app,
      generation: state.generation,
      title: state.book.title,
      asin: state.book.asin,
      percent: state.book.percent,
      position: state.book.position,
    },
  };
}

async function queue_prompt(config, ctx) {
  await ctx.panel.show('queue_prompt');
  return { ok: true, detail: { surface: 'panel' } };
}

async function todo(config, ctx) {
  const scraped = await scrapeTodoLists(config);
  if (!scraped.available) throw new Error(`todo unavailable: ${scraped.reason}`);
  const lists = applyOverrides(scraped.lists);
  const open = openCount(lists);
  if (open === 0) throw new Error('todo unavailable: every item is done');

  await ctx.panel.show('todo', { lists: lists.length, open });

  return {
    ok: true,
    detail: {
      source: 'Notes',
      lists: lists.map((l) => ({ title: l.title, open: l.counts.open, done: l.counts.done })),
      open,
    },
  };
}

export const ACTUATORS = { flashcards, reading, queue_prompt, todo };

export async function deliver(rung, config, ctx = {}) {
  const fn = ACTUATORS[rung];
  if (!fn) throw new Error(`no actuator for rung "${rung}"`);
  if (!ctx.panel) throw new Error('no panel to deliver into');
  return fn(config, ctx);
}
