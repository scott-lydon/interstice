import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Is there a book to go back to?
 *
 * The first implementation asked "is Kindle running", which is exactly backwards:
 * the rung exists in order to put a book in front of you, so gating it on Kindle already being
 * open meant the reading rung could essentially never fire. Caught by a live run,
 * not by the unit tests, because the unit tests were passing in the answer.
 *
 * What we actually want is "this machine has a book in progress", which is a
 * property of the library on disk, not of the running process table.
 */

const KINDLE_DIRS = [
  'Library/Containers/com.amazon.Lassen/Data/Library/eBooks',
  'Library/Containers/com.amazon.Kindle/Data/Library/eBooks',
  'Library/Application Support/Kindle/My Kindle Content',
];

export function readingState(config, { home = os.homedir() } = {}) {
  const app = config.reading?.app ?? 'Kindle';
  const installed = fs.existsSync(`/Applications/${app}.app`);
  if (!installed) return { available: false, reason: 'app_not_installed', app };

  // A library we can see is good evidence of a book in progress. If we cannot see
  // one we still allow the rung: Kindle sandboxes its content and the absence of a
  // readable directory is far more likely to mean "we lack visibility" than "this
  // person owns no books". Refusing to open a reading app that is installed would
  // be the more annoying error.
  let library = null;
  for (const rel of KINDLE_DIRS) {
    const p = path.join(home, rel);
    if (fs.existsSync(p)) {
      library = p;
      break;
    }
  }

  return { available: true, reason: library ? 'library_found' : 'installed', app, library };
}
