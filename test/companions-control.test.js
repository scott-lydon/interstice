import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  modifierClause,
  parseShortcutPlist,
  preferenceFiles,
  readShortcut,
  safeTerm,
} from '../lib/companions-control.js';

/**
 * The setup check can now fix what it reports. Both fixes talk to an application
 * that offers no interface for being told anything, so both are held together by
 * facts about those apps that a future change must not quietly break.
 */

test('a search term cannot carry an AppleScript string out of its quotes', () => {
  // The term is interpolated into `whose name contains "..."`, and AppleScript has
  // no escape for a literal. Anything that could end the string is removed.
  assert.equal(safeTerm('binaural'), 'binaural');
  assert.equal(safeTerm('40 Hz'), '40 Hz');
  assert.ok(!safeTerm('a" & (do shell script "rm -rf ~") & "').includes('"'));
  assert.ok(!safeTerm('a\\"b').includes('\\'));
});

test('modifier flags become the clause System Events expects', () => {
  // These are NSEvent's bits, straight out of the archived MASShortcut.
  assert.equal(modifierClause(1179648), ' using {shift down, command down}');
  assert.equal(modifierClause(1 << 20), ' using {command down}');
  assert.equal(modifierClause(0), '', 'an unmodified key gets no clause at all');
});

test('an unset shortcut is null, not a key code of -1', () => {
  // MASShortcut writes -1 for "none". Pressing key code -1 is not a no-op; it is a
  // keystroke into whatever is in front of you.
  assert.equal(parseShortcutPlist('<key>KeyCode</key><integer>-1</integer>'), null);
  assert.equal(parseShortcutPlist('<plist><dict></dict></plist>'), null);
  assert.deepEqual(
    parseShortcutPlist('<key>KeyCode</key>\n<integer>15</integer>\n<key>ModifierFlags</key>\n<integer>1179648</integer>'),
    { keyCode: 15, flags: 1179648 }
  );
});

test('a sandboxed app keeps its preferences in its container', () => {
  // Be Focused is sandboxed: there is no ~/Library/Preferences file for it at all,
  // and looking only there reported "no shortcut is set" for a shortcut that was.
  const [first, second] = preferenceFiles('com.example.app', { home: '/Users/x' });
  assert.equal(first, '/Users/x/Library/Containers/com.example.app/Data/Library/Preferences/com.example.app.plist');
  assert.equal(second, '/Users/x/Library/Preferences/com.example.app.plist');
});

test('a shortcut is read from the preference file itself, not through defaults', async () => {
  // `defaults export` goes through cfprefsd and can simply never return: measured
  // at over two minutes against a live app, from a command that had answered in
  // milliseconds an hour earlier. A button that hangs the panel is worse than one
  // that does nothing.
  const src = fs.readFileSync(new URL('../lib/companions-control.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function readShortcut'), src.indexOf('export async function pressShortcut'));
  assert.ok(!fn.includes("'export'"), 'readShortcut does not shell out to defaults export');

  // And it really does decode an archived MASShortcut, proved against one built here.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'interstice-prefs-'));
  const dir = path.join(home, 'Library', 'Containers', 'com.test.app', 'Data', 'Library', 'Preferences');
  fs.mkdirSync(dir, { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>KeyCode</key><integer>15</integer>
<key>ModifierFlags</key><integer>1179648</integer></dict></plist>`;
  const inner = path.join(home, 'inner.plist');
  fs.writeFileSync(inner, xml);
  execFileSync('/usr/bin/plutil', ['-convert', 'binary1', inner]);
  const archived = fs.readFileSync(inner).toString('base64');
  fs.writeFileSync(
    path.join(dir, 'com.test.app.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>startShortcut</key><data>${archived}</data></dict></plist>`
  );

  assert.deepEqual(await readShortcut('com.test.app', 'startShortcut', { home }), {
    keyCode: 15,
    flags: 1179648,
  });
  assert.equal(await readShortcut('com.test.app', 'missingShortcut', { home }), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('the timer is looked at before start is pressed', async () => {
  // Start is a toggle, and Be Focused begins the new interval itself after a skip.
  // Pressing start on top of that pauses the timer you just asked for: measured,
  // the menu bar read 24:56 and stayed there.
  const src = fs.readFileSync(new URL('../lib/companions-control.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function startPomodoro'));
  const look = fn.indexOf('pomodoroState');
  const press = fn.indexOf('pressShortcut(start)');
  assert.ok(look > -1 && press > look, 'the menu bar is read before start is pressed');
  assert.match(fn, /verdict === 'on'/, 'and the result is the reading, not the press');
});

test('the skip confirmation is answered by button title, not by coordinates', () => {
  // Be Focused asks "are you sure you want to skip the current interval?" in a
  // panel that never takes keyboard focus: Return, Escape and a click at the
  // button's coordinates all leave it sitting there, swallowing every later
  // keystroke. Accessibility is the only thing that answers it.
  const src = fs.readFileSync(new URL('../lib/companions-control.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function answerSkipConfirmation'));
  assert.match(fn, /whose title is/, 'the button is found by its title');
  assert.ok(!/key code 36|CGEventPost/.test(fn), 'and never by pressing Return or clicking a point');
});
