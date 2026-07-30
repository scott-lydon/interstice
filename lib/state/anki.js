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

export class AnkiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AnkiError';
    this.code = code;
  }
}

export async function invoke(action, params = {}, { url, timeoutMs = 800 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
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
  const { url, timeoutMs, deck } = config.anki;
  const query = deck ? `deck:"${deck}" is:due` : 'is:due';
  try {
    const ids = await invoke('findCards', { query }, { url, timeoutMs });
    return Array.isArray(ids) ? ids.length : 0;
  } catch {
    return null; // unavailable, not zero: the router treats these differently
  }
}

export async function version(config) {
  const { url, timeoutMs } = config.anki;
  return invoke('version', {}, { url, timeoutMs });
}

/** Drop straight onto a card. Not a deck list, not the main window. */
export async function startReview(config) {
  const { url, timeoutMs, deck } = config.anki;
  const name = deck || (await pickDeckWithDue(config));
  if (!name) throw new AnkiError('no deck has cards due', 'NO_DUE');
  const ok = await invoke('guiDeckReview', { name }, { url, timeoutMs: Math.max(timeoutMs, 2000) });
  if (!ok) throw new AnkiError(`guiDeckReview refused deck "${name}"`, 'REVIEW_REFUSED');
  return name;
}

export async function currentCard(config) {
  const { url, timeoutMs } = config.anki;
  try {
    return await invoke('guiCurrentCard', {}, { url, timeoutMs });
  } catch {
    return null;
  }
}

/** First deck that actually has something due, so we never open an empty review. */
export async function pickDeckWithDue(config) {
  const { url, timeoutMs } = config.anki;
  const decks = await invoke('deckNames', {}, { url, timeoutMs });
  for (const name of decks) {
    if (name === 'Default') continue;
    const ids = await invoke('findCards', { query: `deck:"${name}" is:due` }, { url, timeoutMs });
    if (ids.length > 0) return name;
  }
  const anyDue = await invoke('findCards', { query: 'is:due' }, { url, timeoutMs });
  return anyDue.length > 0 ? 'Default' : null;
}
