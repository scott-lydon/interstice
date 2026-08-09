import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/paths.js';
import { ANKI_BUNDLE_IDS } from '../lib/state/anki.js';
import { hideApp } from '../lib/state/system.js';

/**
 * Connecting to Anki must not put Anki on your screen.
 *
 * `open -g -j` asks for an app that starts behind everything and stays hidden, and
 * Anki ignores both: current builds run under a launcher that raises the deck list
 * once the collection is open. So the one button in this project that reaches for
 * another application ended by putting that application in front of the panel, which
 * is the exact interruption the whole thing exists to remove.
 */

test('Anki is put away by bundle identifier, never by the name "Anki"', () => {
  // To System Events this app is called `python`: current builds run the collection
  // out of a venv under /Applications/Anki.app/Contents/MacOS/launcher, and
  // `lsappinfo` reports bundleID net.ankiweb.launcher for it. A hide aimed at a
  // process *named* Anki matches nothing, succeeds, and reports having put away a
  // window that is still on screen. Observed exactly that way: `hidden: true` in the
  // response with the deck list visible behind it.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'state', 'system.js'), 'utf8');
  const hide = src.slice(src.indexOf('export async function hideApp'), src.indexOf('export async function openUrl'));
  assert.match(hide, /bundle identifier is/, 'processes are matched by bundle id');
  assert.ok(!/whose name is/.test(hide), 'and never by name');
  // This is the same trap `isRunning` documents directly above it, which is why it
  // is worth a test rather than a comment.
  assert.match(src, /lsappinfo/, 'the running check already knew this');
});

test('both of the ids Anki ships under are tried', () => {
  assert.deepEqual(ANKI_BUNDLE_IDS, ['net.ankiweb.dtop', 'net.ankiweb.launcher']);
});

test('the window is held down, not pushed once', () => {
  // Anki answers AnkiConnect as soon as the collection is open and raises its main
  // window a moment after that. A single hide at the instant the connection lands
  // therefore hides nothing, and the deck list arrives immediately afterwards.
  // Measured: hidden reported true at 1858ms, window visible again two seconds later.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'state', 'system.js'), 'utf8');
  const hide = src.slice(src.indexOf('export async function hideApp'), src.indexOf('export async function openUrl'));
  assert.match(hide, /holdMs/, 'it keeps at it for a few seconds');
  assert.match(hide, /quiet >= 2/, 'and only stops once the window has stopped coming back');
  assert.match(hide, /if visible of p then/, 'reading the state rather than assuming it');
});

test('only an Anki this started is hidden, never one you opened yourself', () => {
  // Hiding the window someone is typing into is a worse bug than the one this fixes.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'state', 'anki.js'), 'utf8');
  assert.match(src, /launched \? await hideApp\(ANKI_BUNDLE_IDS\) : false/, 'gated on having launched it');
});

test('it is hidden and not quit, so the cards rung keeps working', () => {
  // Quitting would put AnkiConnect back where it was before the button was pressed,
  // so the next question about your cards would start the app all over again.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'state', 'system.js'), 'utf8');
  const hide = src.slice(src.indexOf('export async function hideApp'), src.indexOf('export async function openUrl'));
  assert.ok(!/to quit|terminate|kill/i.test(hide), 'nothing here ends the process');
});

test('an app that is not there is reported as not hidden, rather than as hidden', async () => {
  // The honest answer to "why is Anki still on my screen" is this coming back false.
  const hidden = await hideApp(['com.interstice.no.such.app'], { holdMs: 1200, everyMs: 400 });
  assert.equal(hidden, false);
});

test('being given nothing to hide is not an error', async () => {
  assert.equal(await hideApp([]), false);
});
