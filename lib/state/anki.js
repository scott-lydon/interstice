/**
 * AnkiConnect bridge.
 *
 * Every call is time-boxed. A hung or absent Anki must make the flashcard rung
 * ineligible, never stall the router: the whole point is to be in front of you
 * within a second of the threshold.
 *
 * The failure that will actually bite you is App Nap. macOS suspends Anki when it
 * is not visible, which is exactly the state it is in when we need to query it, and
 * AnkiConnect then stops answering with no error. `doctor` proves this at install
 * time rather than letting it fail silently at 2am.
 */

import { resolveEndpoint } from './anki-discovery.js';
import { disableAppNap, hideApp, isRunning, launchHeadless } from './system.js';

export class AnkiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AnkiError';
    this.code = code;
  }
}

export async function invoke(action, params = {}, { url, timeoutMs = 800, apiKey = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = { action, version: 6, params };
    if (apiKey) payload.key = apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new AnkiError(`AnkiConnect HTTP ${res.status}`, 'HTTP_ERROR');
    const body = await res.json();
    if (body.error) throw new AnkiError(body.error, 'ANKI_ERROR');
    return body.result;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AnkiError(`AnkiConnect timed out after ${timeoutMs}ms (App Nap?)`, 'TIMEOUT');
    }
    if (err instanceof AnkiError) throw err;
    throw new AnkiError(`AnkiConnect unreachable: ${err.message}`, 'UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

/** Number of cards due right now, or null when Anki cannot be reached. */
export async function dueCount(config) {
  const { url, apiKey } = resolveEndpoint(config);
  const { timeoutMs, deck } = config.anki;
  const query = deck ? `deck:"${deck}" is:due` : 'is:due';
  try {
    const ids = await invoke('findCards', { query }, { url, timeoutMs, apiKey });
    return Array.isArray(ids) ? ids.length : 0;
  } catch {
    return null; // unavailable, not zero: the router treats these differently
  }
}

export async function version(config) {
  const { url, apiKey } = resolveEndpoint(config);
  return invoke('version', {}, { url, timeoutMs: config.anki.timeoutMs, apiKey });
}

/** Where we resolved AnkiConnect to, for doctor and the dashboard to report. */
export function endpoint(config) {
  return resolveEndpoint(config);
}

/** The two bundle ids Anki ships under. Current builds run under the launcher. */
export const ANKI_BUNDLE_IDS = ['net.ankiweb.dtop', 'net.ankiweb.launcher'];

/**
 * Get the cards rung answering again, from a button.
 *
 * "AnkiConnect unreachable: fetch failed" is a true sentence and a useless one: it
 * names the symptom of four different states, three of which this can fix without
 * you doing anything.
 *
 *   Anki is not running       start it behind everything with `open -g`
 *   App Nap suspended it      set NSAppSleepDisabled on both bundle ids, then wake it
 *   it is still starting      wait for it, rather than declaring it dead at 800ms
 *   the addon is not there    say so, because that one is genuinely yours to fix
 *
 * Starting Anki is not a thing the router may do to you at 2am, which is why this
 * lives behind a press.
 *
 * And it puts Anki away afterwards. `open -g -j` asks for an app that starts behind
 * everything and stays hidden, and Anki ignores both: current builds run under a
 * launcher that raises the deck list the moment the collection finishes loading. So
 * pressing "reconnect" in a tool whose entire premise is not putting another window
 * in front of you ended with Anki's deck list in front of you. Hidden, not quit: it
 * has to stay running for AnkiConnect to keep answering, it just has no business on
 * your screen.
 *
 * Only ever hidden if this call was the thing that started it. Anki that you opened
 * yourself and were using is yours, and a tool that hides the window you are typing
 * into is a worse bug than the one this fixes.
 */
export async function reconnect(config, { waitMs = 25000, pollMs = 700 } = {}) {
  // In this order, and not overlapped. `disableAppNap` is a `defaults write` of
  // NSAppSleepDisabled into Anki's own domain, and Cocoa reads that preference when
  // the process starts: run it alongside the launch below and the copy of Anki this
  // function just started is the one still subject to App Nap, which is the exact
  // failure the whole reconnect path exists to prevent. The dependency is real, it
  // just runs through the macOS defaults database rather than through a value here.
  const napped = await disableAppNap(ANKI_BUNDLE_IDS);
  const wasRunning = await isRunning('Anki');
  const launched = wasRunning ? false : await launchHeadless('Anki');

  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < waitMs) {
    try {
      // Generously timed on purpose. The ordinary 800ms budget exists so a hung
      // Anki cannot stall the router; nothing is waiting on this one but you.
      const { url, apiKey } = resolveEndpoint(config);
      const v = await invoke('version', {}, { url, timeoutMs: 2500, apiKey });
      // By bundle id, because to System Events this app is called `python`. See
      // `hideApp`. Both ids, because current builds run under the launcher.
      const hidden = launched ? await hideApp(ANKI_BUNDLE_IDS) : false;
      return {
        ok: true,
        version: v,
        endpoint: url,
        wasRunning,
        launched,
        // Reported rather than assumed. Hiding goes through System Events, which a
        // machine that has never granted this automation will refuse, and the honest
        // answer to "why is Anki still on my screen" is this flag being false.
        hidden,
        appNapDisabledFor: napped,
        waitedMs: Date.now() - started,
      };
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const { url } = resolveEndpoint(config);
  return {
    ok: false,
    endpoint: url,
    wasRunning,
    launched,
    appNapDisabledFor: napped,
    waitedMs: Date.now() - started,
    error: lastError?.message ?? 'unknown',
    // Only the steps that are still open. A list that starts with something already
    // done is a list you stop reading.
    how: [
      ...(launched || wasRunning ? [] : ['Open Anki (it could not be started from here)']),
      'In Anki: Tools → Add-ons. AnkiConnect (code 2055492159) must be listed and enabled',
      'If a profile chooser or a dialog is open in Anki, answer it: AnkiConnect does not respond until the collection is loaded',
      `Then press Reconnect again. Interstice is asking ${url}`,
    ],
  };
}

/**
 * Everything due, with the deck and review count of each card, in two calls.
 *
 * `cardsInfo` carries `reps` per card, which is what makes "least studied"
 * answerable at all without a query per deck. Timed once against a real collection, the
 * whole due queue came back in a fifth of a second in these two calls; the per-deck
 * alternative costs one round trip per deck, so its cost grows with the collection
 * while this one does not.
 */
async function dueCardsInfo(config) {
  const { url, apiKey } = resolveEndpoint(config);
  const { timeoutMs, deck } = config.anki;
  const query = deck ? `deck:"${deck}" is:due` : 'is:due';
  const ids = await invoke('findCards', { query }, { url, timeoutMs, apiKey });
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const budget = config.anki.queueTimeoutMs ?? 6000;
  const info = await invoke('cardsInfo', { cards: ids }, { url, timeoutMs: budget, apiKey });
  return Array.isArray(info) ? info : [];
}

/**
 * Rank the decks that have work by how little of it you have done.
 *
 * The measure is mean reviews per due card. It answers the question people actually
 * mean by "least studied": the deck you have put the least into, not the one with
 * the most cards waiting. Decks with no cards due are not ranked at all, because
 * routing into an empty deck is the one thing the ladder must never do.
 *
 * Ties are broken by the larger deck. Several decks here sit at exactly 1.0 mean
 * reviews, and between a one-card deck and an eleven-card deck at the same score,
 * the eleven-card deck is the one that was actually neglected.
 */
export function rankDecks(cards) {
  const byDeck = new Map();
  for (const card of cards) {
    const entry = byDeck.get(card.deckName) ?? { deck: card.deckName, due: 0, reps: 0, lapses: 0 };
    entry.due += 1;
    entry.reps += card.reps ?? 0;
    entry.lapses += card.lapses ?? 0;
    byDeck.set(card.deckName, entry);
  }
  return [...byDeck.values()]
    .map((d) => ({ ...d, meanReps: d.reps / d.due }))
    .sort((a, b) => a.meanReps - b.meanReps || b.due - a.due || a.deck.localeCompare(b.deck));
}

/** Strip Anki's own audio/TTS markup, which we have no player for. */
function clean(html) {
  return String(html ?? '')
    .replace(/\[anki:tts[^\]]*\]/gi, '')
    .replace(/\[sound:[^\]]*\]/gi, '');
}

/**
 * The least studied deck and its cards, ready to render.
 *
 * `question` and `answer` come back already templated by Anki and `css` is the
 * deck's own styling, so the panel shows the card as the collection defines it
 * rather than a reconstruction of it.
 */
export async function leastStudiedQueue(config) {
  const cards = await dueCardsInfo(config);
  if (cards.length === 0) return { deck: null, reason: 'no_due_cards', cards: [], ranking: [] };

  const ranking = rankDecks(cards);
  const chosen = config.anki.deck
    ? ranking.find((d) => d.deck === config.anki.deck) ?? ranking[0]
    : ranking[0];

  const limit = config.anki.queueSize ?? 25;
  const queue = cards
    .filter((c) => c.deckName === chosen.deck)
    .sort((a, b) => (a.reps ?? 0) - (b.reps ?? 0) || (a.due ?? 0) - (b.due ?? 0))
    .slice(0, limit)
    .map((c) => ({
      cardId: c.cardId,
      question: clean(c.question),
      answer: clean(c.answer),
      css: c.css ?? '',
      reps: c.reps ?? 0,
      lapses: c.lapses ?? 0,
      interval: c.interval ?? 0,
      modelName: c.modelName ?? null,
    }));

  return {
    deck: chosen.deck,
    reason: 'least_studied',
    // The evidence for the choice travels with it, so the panel can show why this
    // deck and not another, and the claim can be checked rather than trusted.
    metric: {
      meanReps: Number(chosen.meanReps.toFixed(2)),
      due: chosen.due,
      lapses: chosen.lapses,
      decksWithDue: ranking.length,
      rank: 1,
    },
    ranking: ranking.slice(0, 8).map((d) => ({
      deck: d.deck,
      due: d.due,
      meanReps: Number(d.meanReps.toFixed(2)),
    })),
    cards: queue,
    totalDue: cards.length,
  };
}

/**
 * Answer a card without Anki's window existing.
 *
 * `guiAnswerCard` drives the reviewer, so it requires the reviewer to be open and
 * showing that exact card, which means raising Anki. `answerCards` schedules
 * directly against the collection, so the review is real, is recorded in the
 * revlog, and syncs like any other, while Anki stays where it is.
 *
 * Ease is Anki's own scale: 1 again, 2 hard, 3 good, 4 easy.
 */
export async function answerCard(config, cardId, ease) {
  const { url, apiKey } = resolveEndpoint(config);
  const timeoutMs = config.anki.guiTimeoutMs ?? 8000;
  if (![1, 2, 3, 4].includes(ease)) throw new AnkiError(`invalid ease ${ease}`, 'BAD_EASE');
  const result = await invoke(
    'answerCards',
    { answers: [{ cardId, ease }] },
    { url, timeoutMs, apiKey }
  );
  const ok = Array.isArray(result) ? result[0] === true : Boolean(result);
  if (!ok) throw new AnkiError(`Anki refused the answer for card ${cardId}`, 'ANSWER_REFUSED');
  return { cardId, ease, ok: true };
}
