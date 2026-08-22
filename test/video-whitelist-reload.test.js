import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCached } from '../lib/config.js';
import { isWhitelisted } from '../lib/video/whitelist.js';
import { ROOT } from '../lib/paths.js';

// The whitelist is editable without editing code. This writes a new host into the user config
// file, reloads config (force re-read), and asserts the new host now passes. The prior state of the
// user config file is preserved and restored, so the test leaves the repo exactly as it found it.
const CONFIG_FILE = path.join(ROOT, 'config', 'interstice.config.json');

test('a host added to the user config passes after a reload, no code change', () => {
  const had = fs.existsSync(CONFIG_FILE);
  const backup = had ? fs.readFileSync(CONFIG_FILE, 'utf8') : null;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      focus: { videoWhitelist: ['udemy.com', '*.udemy.com', 'newschool.example'] },
    }, null, 2));
    const cfg = loadCached({ force: true });
    const wl = cfg.focus?.videoWhitelist ?? [];
    assert.ok(wl.includes('newschool.example'), 'the reloaded config carries the new host');
    assert.equal(isWhitelisted('https://www.newschool.example/lesson', wl), true, 'the new host now passes');
    assert.equal(isWhitelisted('https://youtube.com/x', wl), false, 'unrelated hosts still fail');
  } finally {
    if (had) fs.writeFileSync(CONFIG_FILE, backup);
    else fs.rmSync(CONFIG_FILE, { force: true });
    loadCached({ force: true }); // reload back to the original state for any later test
  }
});
