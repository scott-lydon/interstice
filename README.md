# Interstice

**Fills the dead moment after you dispatch an AI agent, before you can decide to waste it.**

You press enter on a prompt. The agent starts working. For the next four minutes you
have no task and, worse, an open question: what should I do right now? Boredom plus an
open decision is the entry condition for a habit loop, and the cheapest answer to an
unwanted question is usually YouTube.

Interstice answers the question for you. It notices the gap the instant it opens, waits
long enough to be sure it is real, then puts something you already decided you wanted in
front of you: flashcards, your book, a place to queue your next prompt. When the agent
finishes or needs you, it pulls you straight back.

No blocking. No friction. No willpower. It competes by being there first.

---

## Why it works this way

**It never asks you anything.** A menu at the moment the gap opens is the same decision
fatigue wearing a different hat. The router picks exactly one activity from a ladder you
ordered in advance.

**It knows a real gap from a pause.** Detection is event driven off the actual agent
transcript, not a guess based on how long you have been still. Reading the last answer
does not count as waiting.

**The way back matters as much as the way out.** If you do not trust being fetched, you
will keep checking, and checking is the decision you were trying to delete.

**It can prove itself wrong.** Every gap is logged. If the vice arrives anyway right
after the flashcards, the dashboard will say so.

## Measured before it was built

The thresholds below came from a count rather than a hunch. These figures were parsed from
one person's own agent transcripts, on one machine, reading timestamps only and no message
content, before any code existed. They are a sample of one operator's habits rather than a
benchmark, and your own numbers will be different.

| Surface | Prompts | Median turn | >=25s | >=3m | >=12m |
|---|---|---|---|---|---|
| Cowork | 4,731 | 3m 54s | 92.4% | 56.3% | 23.2% |
| Claude Code | 1,883 | 53s | 63.8% | 29.5% | 11.9% |

This is not a system that fires twice a day.

---

## Install

Requires macOS and Node 22 or newer. Node 20 runs everything except the in-panel
reader, which needs the global `WebSocket` that arrived in 22; `doctor` says so by
name rather than letting the rung fail at first use. There are no runtime dependencies (a
devDependency, `@playwright/test`, is used only to drive automated UI tests
and is never required to run Interstice itself).

```bash
git clone https://github.com/scott-lydon/interstice.git
cd interstice
./bin/interstice.js doctor      # proves every dependency before you rely on it
./bin/interstice.js install     # writes config, hooks and the LaunchAgent
./bin/interstice.js start
```

`doctor` is not optional politeness. It proves the two dependencies that can silently
null the whole system: that AnkiConnect answers while Anki is in the background (macOS
App Nap suspends it otherwise), and that the transcript watcher sees real events.

## How it works

Five stages. Each hands a fact to the next.

| Stage | What it does |
|---|---|
| **Detect** | Cowork via a recursive FSEvents watch on the session transcripts. Claude Code via a `UserPromptSubmit` hook. Both push into one queue. No polling. |
| **Decide** | At 25 seconds the gap is real. The router picks one rung, filtered by live state, and escalates at 3m and 12m if the current rung runs dry. |
| **Deliver** | One small window, bottom right. The cards, the book, the lists and the capture box all render in it. Anki, Kindle and Notes are read over their own interfaces. No application of yours is ever quit or closed, and the only thing ever hidden is an Anki that Interstice started itself. It does close the headless browser it opened for the book. |
| **Reclaim** | Agent finishes or asks for you: your window comes forward, the activity drops behind, the notification says which surface and why. |
| **Learn** | Every gap is logged and rendered at `http://localhost:7420`. |

### One window

Everything arrives in the same small panel in the bottom right corner. That is the
whole interface: no rung ever opens a second window, and no third-party app is ever
brought to the front to deliver one. Two things you press are exceptions, and the router does
neither of them to you: signing in to Amazon, and "Open the Kindle app instead".

This is a correction, not a preference. The first build activated Anki, then Kindle,
then Obsidian, each in turn as the ladder escalated. Four apps taking the screen in
sequence is four interruptions, which is the problem this project exists to remove
rather than a way of solving it.

So the apps became data sources:

| Rung | Where the content comes from | What you see |
|---|---|---|
| Flashcards | AnkiConnect, with Anki started in the background by `open -g` | The card, rendered with its own deck stylesheet, answered through `answerCards`. Anki is started behind everything and put back there; its deck list can flash, because its launcher ignores the flags asking it to start hidden. |
| Reading | Which book, from the Kindle app's Core Data store. The pages themselves from Amazon's own reader, running in a browser you never see | The book, at the page your Kindle synced to, inside the panel. Arrow keys turn it. |
| To-do | Notes, over Apple events | Your most recent lists, ticked here. Notes never opens and is never edited. |
| Queue | Interstice's own log | A capture box for the next prompt. |

### The ladder

Default order, editable in one file:

1. **Flashcards** if any card is due
2. **Reading** if a book is in progress
3. **Queue next prompt** in the panel's capture box
4. **To-do list**, last, because writing one is itself decision heavy

A rung with no work falls through to the next. The router never delivers you into an
empty deck.

### Which deck, which book, which list

Each rung has to pick one thing, and the obvious pick is usually the wrong one.

**The least studied deck**, not the biggest backlog. The measure is mean reviews per
due card, so a deck reviewed hundreds of times does not win merely by having a lot
waiting. Ties go to the larger deck. The panel shows the arithmetic behind the
choice, so it can be checked rather than trusted.

**The most recently read unfinished book**, where "read" means the position moved.
A book you opened and bounced off has a position of zero and is passed over, the
same way an empty deck is. Progress is measured against the end reading location,
not the file size, so back matter does not leave finished books sitting at 90-something
per cent forever.

**Your most recent to-do lists**, screened on the title first. Most bulleted notes
are transcripts and meeting notes; scoring on the bullets alone fills the rung with
things you were never going to do.

### Two keys

- **Advance** moves you to the next rung, wrapping at the end. It is a *next*, not a
  menu, so there is still nothing to choose between.
- **Stand down** ends routing for the rest of that gap.

Both are logged, so the record shows whether you are escaping the router or the work.

Run `interstice hotkeys` to build two small apps, then bind a key to each in
Shortcuts.app (or Raycast, Alfred, Karabiner, anything that launches an app on a
hotkey). They talk to the daemon over loopback, so a keypress costs milliseconds and
nothing needs Accessibility access.

### When it holds back

Two guards stop it interrupting you, and they behave differently on purpose:

- **You were mid-keystroke.** Transient, so it waits about fifteen seconds and looks
  again, up to four times. Otherwise a gap you could have used is thrown away because
  you happened to be typing at second twenty-five.
- **You already left for another app.** Not transient. It does nothing and does not
  chase you, because following you into Safari is the interruption this exists to
  prevent.

### The book opens itself, in the panel

The reading rung does not offer to open your book. It opens it, at the position
Whispersync holds, and the shelf is something you go and ask for afterwards. Being
handed "continue here / open the app" at the moment the gap opens is the same
decision fatigue the router exists to delete, one screen further in.

For a while it opened in a window of its own, because the three obvious routes are
all closed. Amazon sends `x-frame-options: SAMEORIGIN`, so the reader cannot be
framed inside the panel. The text is encrypted, so it cannot be re-rendered from the
file. Chrome ignores `--load-extension` on current releases, so the page cannot be
given furniture of ours. A second window was what was left, and a second window is the
interruption this project exists to remove.

The fourth route is to run Amazon's reader where nobody is looking. A headless
Chromium holds the session and renders the book at the exact size of the panel's
content area; what arrives is the picture, and what goes back is your clicks and
keys. It is the reader, not a screenshot of one: arrow keys turn the page, links
work, and the position you reach syncs the way it would anywhere else.

Two things it does to the page it is showing. It renders at least 480 points wide, because Chrome
will not lay out narrower and the parts the reader positions from the right edge would otherwise
land on top of the text. A panel already wider than that is rendered at its own width; a narrower
one is rendered at 480 and the picture is scaled down to fit. And it hides Amazon's floating copy of the book
title, with a stylesheet rather than by deleting the node, because the reader
rebuilds its own DOM on every page turn.

The browser shuts down after fifteen minutes with no reading in it. The only page ever written
to disk is the JPEG Vision has to be handed in order to read one, in a temporary directory that
is removed as soon as it answers.

### The words, not a photograph of the words

Amazon draws each page as a single image. The page area of that document contains
zero text nodes and one blob-backed `<img>`, the image carries no alt text, and
there is no accessibility layer to switch on: a picture is all the reader will give
anyone.

A picture of a book is not a book. Scaled into a panel it is small, it is set in
someone else's type at someone else's size, it does not reflow, and none of it can
be selected. So the words are read back off the picture, on this machine, by the
same engine macOS reads text out of photographs with: Vision, over the ObjC bridge.
No dependency and nothing leaves the machine. Timed on one book on one machine it took
about half a second a page and returned every line at full confidence, which is a single
reading rather than a benchmark.

What comes back is set in the panel's own type. Getting from lines to prose is the
part that is easy to get wrong, and four signals do it, none of which works alone:

- **A short line ends a paragraph**, but only on a justified page. Justified text
  reaches the right margin on every line but the last. On a ragged one, a list or
  verse or a title, most lines stop short and the rule would make every line its own
  paragraph, so it is switched off unless more than 60% of the lines reach the edge.
- **Tall lines are a heading**, measured against the page's own type size taken low
  in the distribution. Against the median, a chapter opening whose large type outnumbers the prose has no heading at
  all, and the title joins the first paragraph.
- **A trailing hyphen is a word the renderer broke**, so it is rejoined. `--`, which
  this book uses for an em dash, is not that and is left alone.
- **A gap wider than the usual line spacing ends a block**, measured per kind, because
  a heading's lines sit further apart than a paragraph's and one threshold for the
  whole page would either split every heading or join every paragraph.

The picture stays one press away inside the reading menu, and it comes forward by itself
when the reading was not confident: a diagram, an equation, or one of Amazon's own dialogs
over a blurred page is exactly the thing you need to look at rather than read a
confident transcription of.

### Signing in, without holding a password

The reader has its own browser profile, and the price of that isolation is that
Amazon has never seen you there: the rung would land on a sign-in page instead of on
your book.

Nothing here types a password, and nothing here stores one. Instead the session you
already have moves across: the amazon.com rows of Chrome's cookie store, copied from
your ordinary profile into the reader's, while nothing holds either.

- **Only that one site.** The copy is filtered to amazon.com; every other cookie in
  your browser stays where it is. The one path that copies a whole store is a reader
  profile with no store yet, and it is pruned to Amazon before Chrome ever opens it.
- **Nothing is ever decrypted.** Chrome seals `encrypted_value` with a key in your
  login keychain, one per application rather than per profile, so the same Chrome
  unseals in the reader profile exactly what it sealed in yours. The bytes are moved
  sealed.
- **It happens again by itself.** Amazon rotates that session, so a reader that was
  signed in yesterday can be signed out today. Landing on a sign-in page carries the
  session across again and reloads, at most once every ten minutes, and the panel
  carries the same thing as a button. The browser is closed first, because Chrome
  reads its cookie store at launch and rewrites it on its own schedule: rows written
  underneath a running one change nothing and are then overwritten.
- **Nothing leaves the machine**, and no credential is created, read or stored.
- **Turn it off** with `"reading": { "carrySession": false }`, and undo it by
  deleting `logs/reader-profile`.

If your ordinary browser is not signed in either, the panel's primary offer is
**Sign in to Amazon in Chrome**: a visible Chrome window opens on Amazon's own
sign-in page, on the reader's own profile, and closes itself the moment the session
lands. Carrying the session from your ordinary browser is the quieter second
option, offered underneath, and it only works while that browser is still signed in.
The sign-in page can also be typed into inside the panel, live, with the reader
forwarding your keystrokes. `doctor` says which of the two profiles has a session.

**A passkey is the exception, and it cannot be otherwise.** The QR code in that flow
is drawn by Chrome itself, not by the page, and a browser with no screen has nowhere
to draw it: asked for a passkey, headless Chrome does not refuse, it simply never
answers. There is no image in the page to capture and none in the session to read.
Amazon's own sign-in form has no QR of its own either; it asks for an email address
and then for a code or a password, and all of that types straight into the panel.
So a passkey needs a browser with a screen, which is exactly why the panel opens a
real Chrome window rather than trying to draw the QR itself, and why that is the
primary offer rather than the fallback. Carrying a session out of a browser that is
already signed in is the other way to the same place, and is what this section is
about.

### The setup check

Two things get set up before a work block and forgotten when they are not: the
binaural track, and a pomodoro that is actually counting. When the panel comes up it
says which of them is missing, above whatever the rung is showing.

It is a note, never a gate. No rung is blocked and the banner is dismissible for the
rest of the gap. Nothing starts on its own either, but each line now carries the one
button that would fix it: **Play** puts on the first track in your library that
matches the pattern, and **Start a full interval** begins a whole work interval rather
than resuming whatever was left of the last one. The label names no length, because the
length is Be Focused's own setting, which this product neither reads nor writes.

Neither button reports its own success. Both do the thing and then take the reading
again, and the banner shows the strip of menu bar it read, so what happened is
visible rather than asserted.

Be Focused is not scriptable, publishes no state, and its status item refuses
`AXPress`, so the timer is started the way you would start it: by pressing the keys
it already answers to, read out of its own preferences rather than guessed. Starting
a whole interval means skipping the current one, and it asks before it does that. Its
question is answered through accessibility, by the button's title, because that panel
never takes keyboard focus: Return, Escape and a click at the button's coordinates
all leave it sitting there swallowing every later keystroke.

### When Anki stops answering

"AnkiConnect unreachable: fetch failed" is a true sentence and a useless one. It is
one of four states, and three of them the cards rung can fix without you leaving the
panel, so it offers a **Reconnect** button: it starts Anki behind everything with
`open -g`, turns off App Nap for both of the bundle ids Anki ships under, and then
waits for the socket rather than declaring it dead at the 800ms the router allows
itself. Anki's own launcher ignores the flags that ask it to start hidden, so its deck list can
flash; Interstice puts it straight back behind everything, and the panel says so when it will not go.

The fourth state is yours: the addon is missing, or a dialog inside Anki is holding
the collection. When that is what it is, the button says so and names the steps.

| Companion | How it is read | Verdicts |
|---|---|---|
| Binaural beats | Music is asked for its player state and current track, and the track name is matched against a pattern you can edit | `on`, `other` (playing, but not that), `off` |
| Pomodoro | Be Focused publishes nothing at all, so the countdown on the menu bar is photographed three times, a little over a second apart | `on` (every pair differs), `paused` (none do), `off` (no countdown there) |

Three samples rather than two, because two cannot tell a tick from something crossing
the strip once and settling: a window going full screen produced a false "counting
down" on this machine before the third sample was added. A window reaching up into
the menu bar is checked for first, and a mixed result reports `unknown` rather than
picking the verdict it likes.

A companion that could not be read is `unknown`, and `unknown` says nothing. A warning
fired on a reading that was never taken is a warning you learn to ignore, and then the
real ones stop working too. The banner shows the strip of menu bar it read, so the
verdict can be checked rather than trusted.

## Commands

```
interstice doctor          Prove every dependency. Exits non-zero when a required check fails.
interstice install         Write config, install hooks and the LaunchAgent, which
                           starts Interstice at login and restarts it if it dies.
interstice uninstall       Remove the hooks and the LaunchAgent. Leaves your logs.
interstice start [--foreground]
interstice stop
interstice status          Current gap, counters, health.
interstice advance         Move to the next rung (also bound to a hotkey).
interstice standdown [--day]
interstice dashboard       Open the log UI in your browser.
interstice hotkeys         Build the advance and stand-down apps, and print how to
                           bind a key to each.
interstice stats [--tune]  Summarise your gaps. --tune suggests thresholds from
                           your own data rather than the shipped defaults.
interstice simulate <sec>  Drive a synthetic gap of N seconds. Debug route.
```

## Debug route

Real gaps depend on an agent actually running, which makes some states slow to reach.
`interstice simulate` and the `/debug` page drive the daemon into states that are slow
to reach for real: arm a gap, walk the ladder, trigger reclaim, force any companion
verdict. Nothing there fabricates log
data; simulated gaps are tagged `synthetic: true` and excluded from the statistics.

## Configuration

`config/interstice.config.json`, created by `install` from the checked in defaults.

```json
{
  "arm": 25, "mid": 180, "long": 720, "cooldown": 90,
  "ladder": ["flashcards", "reading", "queue_prompt", "todo"],
  "focusMode": "take",
  "idleVetoMs": 4000,
  "panel": { "width": 640, "height": 900, "margin": 24, "side": "bottom-right", "raiseOnDeliver": true },
  "reading": { "app": "Amazon Kindle", "carrySession": true, "readerPort": 7421, "idleCloseMs": 900000 },
  "todo": { "source": "notes", "maxLists": 3 },
  "companions": {
    "enabled": true,
    "binaural": { "app": "Music", "match": "binaural|isochronic|solfeggio|[0-9]{2,3} ?hz|gamma|alpha|theta|delta|focus|concentration" },
    "pomodoro": { "app": "Be Focused", "minTimerWidth": 44, "sampleGapMs": 1200 }
  }
}
```

## Things that will silently break, and what handles them

Every one of these produces *nothing happening*, with no error, which is the failure
this project can least afford. `doctor` proves the ones it can reach; the rest are handled in
code, and are named here so the mitigation can be found rather than rediscovered.

| Trap | Why it is invisible | Handled by |
|---|---|---|
| macOS App Nap suspends backgrounded Anki | AnkiConnect just stops answering | `doctor --fix` sets `NSAppSleepDisabled` on **both** `net.ankiweb.dtop` and `net.ankiweb.launcher`; current builds run under the launcher, so setting only the documented one looks right and does nothing |
| AnkiConnect's port is user editable | a hardcoded 8765 makes the top rung permanently unavailable | the port and any API key are read from the addon's own config |
| Anki runs inside a Python venv | System Events reports its process name as `python`, so app-name guards break | frontmost is read via `lsappinfo` display names, which also needs no Automation grant |
| `ioreg -c IOHIDSystem -d 1` returns no properties without `-r` | idle time reads as null, and the idle veto silently switches off | correct flags, plus a regression test |
| Cowork changes where it writes sessions | detection goes quiet and looks like calm | the daemon logs `DETECTION_SILENT` after 24h with no events, and the dashboard says so |
| Two Kindle apps are installed and both claim `kindle://` | an untargeted open is decided by Launch Services, so you land in the wrong library | the newer app is addressed by bundle id, and it is also the only one that records a reading position |
| macOS keeps another app's container behind Full Disk Access | the daemon runs under launchd, which cannot raise that prompt: the read comes back "Operation not permitted" or blocks on a dialog nobody saw, and the rung reports no book, which reads as owning none | the refusal is reported as itself (`book_data_forbidden`) with the fix named, and the last successful reading is kept and reused, always labelled with when it was taken |
| `copyfile` blocks where `read` does not | `fs.copyFileSync` and `cp` both clone extents and carry extended attributes, and on this store that call hangs while a plain read of the same bytes returns at once | the bytes are read and written directly, in this process, never through `copyfile` |
| A read that blocks cannot be cancelled | node hands it to a four-thread pool and an `AbortSignal` will not take it back, so a stuck read every few seconds ends with no asynchronous I/O anywhere in the daemon | reads are abandoned rather than awaited, counted per file, and never more than two outstanding |
| TCC access does not follow into a child process | so "run the read in a killable subprocess" trades a hang for a refusal: the child is denied where the parent is allowed | proved with a launchd job, and the read stays in-process |
| Notes' own store is TCC protected | a direct read of `NoteStore.sqlite` returns "Operation not permitted" | Notes is read over Apple events, which needs only the Automation grant that is already required |
| Reading Notes one property at a time | it works, so nothing looks wrong; it just gets slower with every note you own. Timed once here, 40 notes took 104 seconds | properties are fetched in bulk, one Apple event per property for the whole library, which returned in 0.3 seconds on that same reading |
| Chrome drops window flags passed to an already-running instance | the panel opens somewhere other than where it was placed | the panel runs in its own `--user-data-dir`, so the flags reach a process that will honour them |
| The LaunchAgent names a Homebrew node by version | `brew upgrade node` deletes that Cellar directory, the job then fails at every login, and the only symptom is Interstice never appearing, which looks like a quiet day | `install` writes the stable symlink after proving it is node 22 or newer, and `doctor` warns if the plist points at a path that is gone or versioned |
| Be Focused publishes no timer state | it is not scriptable, its group container holds no running interval, and its status item has no `AXTitle`, so any state you infer from the app is a guess | the menu bar countdown is photographed three times, a second apart; a running timer differs across every pair and a paused one across none |
| Something crosses the menu bar mid-reading | one changed pair looks exactly like one tick, so a window going full screen reads as a running timer | three samples, an obstruction check before any capture, and `unknown` for a mixed result |
| Music refuses the Automation grant | the error reads as "nothing is loaded", which is a state, so the panel would nag you about music you have on | `-1743` is separated from a genuine empty player and reported as `unknown`, which never warns |
| An open panel keeps running the code it loaded | an edit to the UI never reaches the window that is showing it | the page watches the source's timestamp and reloads itself when it moves |
| `Page.startScreencast` is documented as pushing a frame when the page changes | on the Kindle reader it pushed 41 a second into a book nobody was turning, and held Chrome at 94% of a core, which reads as "the reader is expensive" rather than as a bug | frames are pulled at the rate the panel polls, and the sequence number only moves when the bytes do, so an unchanged page costs one comparison and no download |
| A browser killed rather than closed loses the cookies it had not written yet | Amazon rotates the session token, so the profile is left holding one that no longer works and your book asks you to sign in for no visible reason | `Browser.close` first, SIGKILL only for a browser that will not answer, and a sign-in page carries the session across again by itself |
| Chrome will not lay out a page below 480 points wide | the reader lays out for 480 in a 412-point panel and everything it positions from the right edge lands on the text: the floating book title printed itself across the second line | the render is asked for at 480 in the panel's proportions and scaled down, and Amazon's floating title is hidden with a stylesheet, which survives the DOM being rebuilt on every page turn |
| `defaults export` reads another app's preferences through cfprefsd | it can simply never return: measured here at over two minutes against a live app, from a command that had answered in milliseconds an hour earlier | the preference file is read directly, from inside the app's sandbox container, where a sandboxed app's preferences actually live |
| Be Focused asks before skipping an interval | its confirmation never takes keyboard focus, so Return, Escape and a click at the button's coordinates all leave it open, and it then swallows every keystroke meant for the timer | the confirmation is answered through accessibility, by the button's title |
| Be Focused's start shortcut is a toggle, and it starts the new interval itself after a skip | pressing start on top of that pauses the timer you just asked for: the menu bar read 24:56 and stayed there | the menu bar is read before start is pressed, and the answer the panel shows is that reading rather than the press |

## The control surface is authenticated

The daemon's HTTP surface binds to loopback, and loopback binding is not access control. Any page
you visit in an ordinary browser can reach `127.0.0.1`, and a `text/plain` POST is not preflighted,
so without a check a web page could reschedule your Anki cards, write your to-do state, or type
into the signed-in Amazon session the reader holds. DNS rebinding would let it read the responses
too.

Three checks run before any handler sees a request:

| check | what it stops |
|---|---|
| `Host` must be loopback on this port | DNS rebinding, which arrives carrying the attacker's hostname |
| `Origin`, when present, must be this daemon's own | a cross-origin POST from a page you are visiting |
| `x-interstice-token` must match | anything else that can reach the port |

The token is generated on first run into `logs/control-token` with mode `0600`, never shipped as
a default, and compared in constant time. The served pages are the only unauthenticated route,
because serving a page is how the browser is given the token: a small bootstrap in the document
head wraps `fetch` so every request the page makes carries it.

Local clients read the same file. `interstice status`, `doctor`, and the hotkey apps all do this
for you; nothing asks you to copy a value anywhere. If you drive the API by hand:

```bash
curl -H "x-interstice-token: $(cat logs/control-token)" http://127.0.0.1:7420/api/health
```

A request that is refused says which check refused it and how to satisfy it.

## The panel while it is open

Three things it does that are not a rung of the ladder.

### It shows how long you have been waiting

The moment a prompt goes out, the panel starts a clock for that session and shows the time
waited so far. When the answer lands it says so and the clock stops. Two prompts in flight
are two independent clocks, cleared independently, and the surface makes no difference: a
Cowork submit and a Claude Code submit are the same event by the time the indicator sees
them.

### Reading gets the whole panel

While the reading rung is up, the page itself takes at least 90% of the panel in both
directions. Everything else, the rung buttons, the book title, the progress bar, the status
line, moves behind one menu button in the corner. Arrow keys still turn the page, and a
pager that fades in on hover or keyboard focus turns it with the mouse without opening the
menu at all.

### The stars are on a calendar

The calendar lives behind that same menu button rather than adding a second one. It shows a
month at a time or a single day, and each star opens to the block that earned it, with the
clock times it ran between. A fresh install renders an empty calendar, never a sample one.

## Focus blocks and stars

A completed 25-minute unbroken focus block earns one star. Configure it under `focus` in
`config/interstice.config.json`:

- `focus.blockMinutes`: minutes of unbroken focus that earn one star (default `25`).
- `focus.blacklistApps`: apps whose coming frontmost forfeits the block (default: Slack, Discord,
  Messages, Mail, X, Twitter, Instagram, TikTok). The Interstice panel itself never forfeits a block.
- `focus.videoWhitelist`: video source domains that do not forfeit a block; matched on the whole
  host, exactly or as a dot-suffix, so `www.udemy.com` and `sub.udemy.com` pass, `bbc.co.uk`
  matches itself and its subdomains and nothing else under `.co.uk`, and a lookalike like
  `udemy.com.evil.example` does not (default: Udemy).
- `focus.videoBreakAfterMs`: how long non-whitelisted video must play continuously before it
  forfeits the block, so a one-frame autoplay costs nothing (default `4000`).
- `focus.videoBrowsers`: the browsers to read play state from, as
  `{ "name": "Chrome", "wsUrl": "ws://127.0.0.1:9222/devtools/browser/..." }` entries. Ships empty,
  because a browser that was not started with `--remote-debugging-port` has no endpoint to read and
  there is no way to discover one after the fact. With no entries the video breaker reads nothing
  and forfeits nothing; the app and display breakers are unaffected.

**Scope: Chromium-family browsers only.** Video detection reads tab URL plus real play state over
the DevTools protocol, so it sees any browser you started with `--remote-debugging-port` and listed
under `focus.videoBrowsers`. Safari exposes no such endpoint and is out of scope, as are native
video apps (a desktop Netflix app, QuickTime).

## Privacy

Interstice reads message *timestamps and structure* from agent transcripts. It never
reads, stores, transmits or logs the content of your prompts or the agent's replies.

To render the rungs it does read content: your due cards, the title and position of
your current book, and the text of the to-do lists it finds. None of it leaves the
machine. Nothing is written back to Notes or Kindle. Two things are written outside `logs/`:
the card review you answer, which lands in Anki's collection exactly as answering it in Anki
would, and the App Nap preference on Anki's two bundle ids, described under the traps below. It does stay on this
Mac, under `logs/`. This is everything Interstice itself writes there:

| file | what it holds |
|---|---|
| `todo_state.jsonl` | which to-do items you ticked in the panel |
| `queued_prompts.jsonl` | the prompts you typed into the capture box for later |
| `todo_cache.json` | the last readable to-do lists, so a closed Notes shows the last good answer with its age rather than a blank rung |
| `reading_cache.json` | the title and position of your current book, for the same reason |
| `stars.jsonl` | one line per focus block you completed, with its start and end |
| `gaps.jsonl`, `events.jsonl`, `hook-events.jsonl` | gap timings and rung decisions, never prompt or reply text |
| `control-token` | the local API token, mode 0600 |
| `reader-profile/` | a Chrome profile of its own, holding the carried amazon.com cookies. The most sensitive thing here, and the reason `carrySession: false` and deleting this directory are both documented above |
| `panel-profile/` | a second Chrome profile, for the panel window itself. No account, no cookies worth anything |
| `launchd.out.log`, `launchd.err.log`, and `daemon.log` when started without `--foreground` | operational lines: what started, what a rung decided, what failed. No prompt or reply text |
| `interstice.pid`, `panel.pid` | process ids, so a second start does not race the first |

`logs/` is gitignored, so none of it is committed, and `interstice uninstall` leaves it
in place rather than deciding for you. It is an ordinary directory rather than a
private one, so a tool you point at it can leave files of its own alongside these;
nothing above is written by anything but Interstice.

Two exceptions to "nothing leaves the machine": AnkiConnect on localhost, and
Amazon's own reader, which the reading rung loads in a browser of its own to draw
the book. That browser talks to Amazon exactly as your own would, signed in as you,
and Interstice reads nothing out of it beyond the picture it puts in the panel and
the line that says which page you are on.

## License

MIT. See [LICENSE](LICENSE).
