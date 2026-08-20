import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Signing you in by carrying the session you already have.
 *
 * The panel runs its own browser profile, which is what makes its window flags
 * reliable, and the price of that isolation is that Amazon does not know you there:
 * the reading rung lands on a sign-in page instead of on your book.
 *
 * Typing a password was not an option and should not have been one. No Amazon
 * credential exists in the vault, the account authenticates with a passkey, and a
 * tool that fills in passwords is a tool that has to hold them.
 *
 * You are already signed in, in your ordinary browser. So the session moves rather
 * than being recreated: the amazon.com rows of Chrome's cookie store, copied from
 * your default profile into the reader's, on the same machine, for one site.
 *
 * The values stay encrypted the whole way. Chrome seals `encrypted_value` with a key
 * it keeps in the login keychain, one key per application rather than per profile,
 * so the same Chrome unseals in the reader profile exactly what it sealed in yours.
 * Nothing here decrypts anything, nothing is written in the clear, and nothing
 * leaves the machine.
 */

/** Where your ordinary Chrome keeps its cookies. */
export function defaultChromeCookies({ home = os.homedir() } = {}) {
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');
}

export function panelCookies(profile) {
  return path.join(profile, 'Default', 'Cookies');
}

// Amazon spreads a signed-in session over several hosts. Matching on the registrable
// domain keeps `read.amazon.com`, `www.amazon.com` and `.amazon.com` together while
// leaving every other site in your browser where it is.
const AMAZON = "(host_key LIKE '%amazon.com' OR host_key LIKE '%.amazon.com')";

// The cookie that says you are signed in rather than merely that you have been here.
const SESSION_COOKIE = 'at-main';

async function sqlite(file, sql, { timeoutMs = 4000 } = {}) {
  const { stdout } = await run('/usr/bin/sqlite3', [file, sql], { timeout: timeoutMs });
  return stdout.trim();
}

/** Chrome refuses a cookie store whose shape it does not recognise, so check first. */
async function columns(file, timeoutMs) {
  const out = await sqlite(file, "SELECT group_concat(name) FROM pragma_table_info('cookies');", {
    timeoutMs,
  });
  return out;
}

export async function hasAmazonSession(cookieFile, { timeoutMs = 4000 } = {}) {
  if (!fs.existsSync(cookieFile)) return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookies-'));
  try {
    const copy = path.join(tmp, 'Cookies');
    fs.writeFileSync(copy, await fs.promises.readFile(cookieFile));
    const n = await sqlite(
      copy,
      `SELECT count(*) FROM cookies WHERE ${AMAZON} AND name = '${SESSION_COOKIE}';`,
      { timeoutMs }
    );
    return Number(n) > 0;
  } catch {
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Which session a store is holding, as an opaque mark rather than a value.
 *
 * Enough to answer "are these two the same session", which is the only question
 * asked of it. The value stays sealed: this is the length and a hash of the
 * ciphertext, so nothing here has to decrypt anything to compare.
 */
export async function sessionMark(cookieFile, { timeoutMs = 4000 } = {}) {
  if (!fs.existsSync(cookieFile)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookies-'));
  try {
    const copy = path.join(tmp, 'Cookies');
    fs.writeFileSync(copy, await fs.promises.readFile(cookieFile));
    const out = await sqlite(
      copy,
      `SELECT hex(encrypted_value) FROM cookies WHERE ${AMAZON} AND name = '${SESSION_COOKIE}' LIMIT 1;`,
      { timeoutMs }
    );
    return out || null;
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Carry the amazon.com cookies from one profile to another.
 *
 * Only ever called while nothing is holding the target profile: Chrome writes its
 * cookie store on its own schedule and would overwrite this underneath us.
 */
export async function carryAmazonSession({ from, to, timeoutMs = 6000 } = {}) {
  if (!fs.existsSync(from)) return { carried: 0, reason: 'no Chrome profile to carry from' };
  if (await hasAmazonSession(to, { timeoutMs })) {
    return { carried: 0, reason: 'the panel is already signed in' };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-cookies-'));
  try {
    // Copied first because it is a live store owned by your running browser, and
    // read rather than cloned for the same reason the book store is.
    const source = path.join(tmp, 'source');
    fs.writeFileSync(source, await fs.promises.readFile(from));

    const available = await sqlite(
      source,
      `SELECT count(*) FROM cookies WHERE ${AMAZON} AND name = '${SESSION_COOKIE}';`,
      { timeoutMs }
    );
    if (Number(available) === 0) {
      return { carried: 0, reason: 'your browser is not signed in to Amazon either' };
    }

    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) {
      // No store yet. Take the shape from the source, then keep only Amazon: this
      // is the one path where a whole cookie store gets copied, and it must not
      // stay that way for a second longer than it takes to prune it.
      fs.copyFileSync(source, to);
      await sqlite(to, `DELETE FROM cookies WHERE NOT ${AMAZON};`, { timeoutMs });
    } else {
      const [a, b] = await Promise.all([columns(source, timeoutMs), columns(to, timeoutMs)]);
      if (a !== b) return { carried: 0, reason: 'the two cookie stores have different shapes' };
      await sqlite(
        to,
        `ATTACH DATABASE '${source.replace(/'/g, "''")}' AS src;`
          + `INSERT OR REPLACE INTO cookies SELECT * FROM src.cookies WHERE ${AMAZON};`
          + 'DETACH DATABASE src;',
        { timeoutMs }
      );
    }

    const carried = Number(await sqlite(to, `SELECT count(*) FROM cookies WHERE ${AMAZON};`, { timeoutMs }));
    return { carried, reason: carried ? 'signed in from your own browser session' : 'nothing carried' };
  } catch (err) {
    // Never fatal. Failing to carry the session costs you a sign-in page, which is
    // where you were anyway.
    return { carried: 0, reason: err.message.split('\n')[0] };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
