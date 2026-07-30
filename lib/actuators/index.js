import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as anki from '../state/anki.js';
import { activate, openUrl } from '../state/system.js';
import { readingState } from '../state/reading.js';
import { appendJsonl } from '../logger.js';
import { QUEUED_PROMPTS } from '../paths.js';

const run = promisify(execFile);

/**
 * Actuators put an activity in front of you.
 *
 * Hard rule, enforced by a test that greps this directory: no actuator may quit,
 * hide, or close anything. Delivery only ever changes which window is in front, so
 * your Cowork window keeps its exact state and stays one keystroke behind.
 *
 * Every actuator returns {ok, detail} and throws only on genuine failure, so the
 * engine can fall through to the next rung rather than leaving you with nothing.
 */

async function flashcards(config) {
  // Raise Anki BEFORE driving its GUI. A backgrounded Anki answers data queries
  // fine (with App Nap disabled) but its GUI calls can block for seconds, which
  // was blowing the timeout and losing the top rung entirely.
  await activate('Anki');
  await new Promise((r) => setTimeout(r, 250));
  const deck = await anki.startReview(config);
  const card = await anki.currentCard(config);
  return {
    ok: true,
    detail: { deck, landedOnCard: Boolean(card), cardId: card?.cardId ?? null },
  };
}

async function reading(config) {
  const state = readingState(config);
  if (!state.available) throw new Error(`reading unavailable: ${state.reason}`);
  await activate(state.app);
  return { ok: true, detail: { app: state.app, evidence: state.reason } };
}

/**
 * A focused capture window for your next prompt.
 *
 * Rendered by the daemon and opened in a chromeless browser window so it behaves
 * like a small native panel rather than yet another tab you have to find. Falls
 * back to a normal browser window when no Chromium-family browser is present.
 */
async function queue_prompt(config) {
  const url = `http://127.0.0.1:${config.port}/capture`;
  const appMode = [
    'Google Chrome',
    'Brave Browser',
    'Microsoft Edge',
    'Chromium',
  ];

  for (const browser of appMode) {
    try {
      await run('/usr/bin/open', ['-na', browser, '--args', `--app=${url}`, '--window-size=560,520'], {
        timeout: 4000,
      });
      appendJsonl(QUEUED_PROMPTS, { ts: Date.now(), event: 'capture_opened', via: browser });
      return { ok: true, detail: { surface: 'app-window', browser } };
    } catch {
      /* not installed; try the next */
    }
  }

  await openUrl(url);
  appendJsonl(QUEUED_PROMPTS, { ts: Date.now(), event: 'capture_opened', via: 'default-browser' });
  return { ok: true, detail: { surface: 'browser-tab' } };
}

async function todo(config) {
  const vault = encodeURIComponent(config.todo.vault);
  const file = encodeURIComponent(config.todo.note);
  await openUrl(`obsidian://open?vault=${vault}&file=${file}`);
  await activate('Obsidian');
  return { ok: true, detail: { vault: config.todo.vault, note: config.todo.note } };
}

export const ACTUATORS = { flashcards, reading, queue_prompt, todo };

export async function deliver(rung, config, ctx = {}) {
  const fn = ACTUATORS[rung];
  if (!fn) throw new Error(`no actuator for rung "${rung}"`);
  return fn(config, ctx);
}
