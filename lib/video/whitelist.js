// The video source whitelist (4.3). Match on registrable domain, so www.udemy.com and any
// sub.udemy.com pass, while a lookalike like udemy.com.evil.example does not. A malformed or empty
// URL is a specific error, never a silent pass: a source we cannot name is a source we cannot trust
// to be whitelisted.

/** Thrown when a URL cannot be parsed into a host to check. */
export class BadVideoURLError extends Error {
  constructor(url) {
    super(`cannot whitelist an unparseable video URL: ${JSON.stringify(url)}. Remedy: the probe must supply a full http(s) URL.`);
    this.name = 'BadVideoURLError';
  }
}

/** The registrable domain of a URL, e.g. https://www.udemy.com/x -> "udemy.com". Throws on garbage. */
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

/**
 * Whether a URL's registrable domain matches any whitelist pattern. A pattern is a bare domain
 * (`udemy.com`) or a `*.domain` wildcard; both are compared on registrable domain, so a lookalike
 * parent domain cannot slip through.
 * @throws BadVideoURLError on an unparseable URL (never a silent pass).
 */
export function isWhitelisted(url, patterns = []) {
  const domain = registrableDomain(url);
  return patterns.some((p) => {
    const bare = String(p).replace(/^\*\./, '').toLowerCase();
    const pd = registrableDomain(`https://${bare}`);
    return domain === pd;
  });
}
