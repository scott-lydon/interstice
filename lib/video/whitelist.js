// The video source whitelist. An entry matches a host exactly, or as a dot-suffix of it, so
// `udemy.com` passes udemy.com and www.udemy.com and sub.udemy.com, while a lookalike like
// udemy.com.evil.example does not. A malformed or empty URL is a specific error, never a silent
// pass: a source we cannot name is a source we cannot trust to be whitelisted.

/** Thrown when a URL cannot be parsed into a host to check. */
export class BadVideoURLError extends Error {
  constructor(url) {
    super(`cannot whitelist an unparseable video URL: ${JSON.stringify(url)}. Remedy: the probe must supply a full http(s) URL.`);
    this.name = 'BadVideoURLError';
  }
}

/**
 * The last two labels of a URL's host, e.g. https://www.udemy.com/x -> "udemy.com".
 *
 * NOT used for whitelist matching, and deliberately so. It is right for single-label TLDs and
 * wrong for the rest: `bbc.co.uk` collapses to `co.uk`, and matching on that made a whitelist
 * entry of one BBC host whitelist every `.co.uk` host there is. The comment here used to claim
 * the opposite, that the simplification "fails safe by being stricter". It failed open. Kept as
 * an exported helper because it names a real thing, with the matching moved to `hostMatches`.
 *
 * Throws on garbage.
 */
export function registrableDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new BadVideoURLError(url);
  }
  if (!host) throw new BadVideoURLError(url);
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return host; // localhost and the like
  // Registrable domain is the last two labels. This is a deliberate simplification: it is exact for
  // the common .com/.net/.org case the whitelist targets, and it fails safe for multi-part TLDs by
  // being stricter (a whitelist entry of the full host still matches below).
  return parts.slice(-2).join('.');
}

/** The host of a URL, lowercased. Throws on garbage. */
export function hostOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new BadVideoURLError(url);
  }
  if (!host) throw new BadVideoURLError(url);
  return host;
}

/**
 * Does `host` fall under `entry`?
 *
 * Exact, or a dot-suffix. No public-suffix list is needed for this and none is wanted: comparing
 * the whole host rather than a guessed registrable domain is both stricter and simpler. `bbc.co.uk`
 * matches bbc.co.uk and www.bbc.co.uk and nothing else; `udemy.com` does not match
 * udemy.com.evil.example, because that host neither equals it nor ends with a dot and it.
 */
export function hostMatches(host, entry) {
  const bare = String(entry).replace(/^\*\./, '').toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!bare) return false;
  return host === bare || host.endsWith(`.${bare}`);
}

/**
 * Whether a URL's host matches any whitelist pattern. A pattern is a bare domain (`udemy.com`) or
 * a `*.domain` wildcard, and the two mean the same thing here: the domain and everything under it.
 * @throws BadVideoURLError on an unparseable URL (never a silent pass).
 */
export function isWhitelisted(url, patterns = []) {
  const host = hostOf(url);
  return patterns.some((p) => hostMatches(host, p));
}
