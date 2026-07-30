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

/**
 * Drop straight onto a card. Not a deck list, not the main window.
 *
 * GUI actions are slower than data queries and, on a backgrounded Anki, can block
 * for seconds. So they get their own generous timeout rather than the query budget,
 * which is tuned for a router that must decide in under a second.
 */
export async function startReview(config) {
  const { url, apiKey } = resolveEndpoint(config);
  const { timeoutMs, deck } = config.anki;
  const name = deck || (await pickDeckWithDue(config));
  if (!name) throw new AnkiError('no deck has cards due', 'NO_DUE');
  const guiTimeout = config.anki.guiTimeoutMs ?? 8000;
  const ok = await invoke('guiDeckReview', { name }, { url, timeoutMs: guiTimeout, apiKey });
  if (!ok) throw new AnkiError(`guiDeckReview refused deck "${name}"`, 'REVIEW_REFUSED');
  return name;
}

export async function currentCard(config) {
  const { url, apiKey } = resolveEndpoint(config);
  const { timeoutMs } = config.anki;
  try {
    return await invoke('guiCurrentCard', {}, { url, timeoutMs, apiKey });
  } catch {
    return null;
  }
}

/**
 * Which deck to open.
 *
 * Two calls, not one per deck. The first implementation looped every deck asking
 * "anything due here?", which on a real collection (this host has dozens of decks
 * and 1,571 cards due) took long enough to blow the timeout before a card ever
 * appeared. Instead: find due cards once, then ask which deck the first one is in.
 */
export async function pickDeckWithDue(config) {
  const { url, apiKey } = resolveEndpoint(config);
  const { timeoutMs } = config.anki;
  const due = await invoke('findCards', { query: 'is:due' }, { url, timeoutMs, apiKey });
  if (!Array.isArray(due) || due.length === 0) return null;
  const info = await invoke('cardsInfo', { cards: [due[0]] }, { url, timeoutMs: timeoutMs * 2, apiKey });
  return info?.[0]?.deckName ?? null;
}
