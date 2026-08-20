# Manual verification

Everything below is something you can check yourself, in order, without reading any code. Each step
says what to run, what you should see, and what it would mean if you saw something else.

Run everything from the repo root with `/opt/homebrew/bin` on PATH. A non-login shell will not see
`node`.

```bash
cd /Users/scottlydon/Developer/interstice
export PATH="/opt/homebrew/bin:$PATH"
```

---

## 1. The suite, from a clean start

```bash
npm test; echo "exit $?"
```

**Expect** at least `344 pass`, `0 fail`, `exit 0`. That includes six browser specs which start a
real Chromium, and the whole suite still finishes in about five seconds.

**If it fails on the `.pw.mjs` specs**, the bundled browser is missing: `npx playwright install
chromium`. It should not need a separately installed Chrome; if it asks for one, that is a
regression of the fix in commit `7aa8ea1`.

## 2. The daemon is up and answering

```bash
node bin/interstice.js status
```

**Expect** a `running pid`, an uptime, and counters. If it says nothing is listening, start it with
`node bin/interstice.js start --foreground` in another terminal.

## 3. The control surface refuses what it should

This is the one worth doing by hand, because it is the check that protects everything else.

```bash
# A page you visit could send this. It must be refused.
curl -s -o /dev/null -w "cross-origin POST -> %{http_code}\n" -X POST \
  -H 'Content-Type: text/plain' -H 'Origin: https://evil.example' \
  -d '{"text":"probe"}' http://127.0.0.1:7420/api/queued

# No token at all.
curl -s -o /dev/null -w "no token GET     -> %{http_code}\n" http://127.0.0.1:7420/api/health

# With the token, as a local client would.
curl -s -o /dev/null -w "with token GET   -> %{http_code}\n" \
  -H "x-interstice-token: $(cat logs/control-token)" http://127.0.0.1:7420/api/health

# The token file must not be readable by anyone else.
stat -f '%Sp %N' logs/control-token
```

**Expect** `403`, `401`, `200`, and `-rw-------`. Any `200` on the first two means the surface is
open; that was the state before commit `e867877`.

## 4. Doctor proves things answer, not that they exist

```bash
node bin/interstice.js doctor
```

**Expect** every required check green and a final line naming how many optional checks warned.
Optional warnings are normal: they mean a rung's dependency is unavailable right now, not that the
install is broken.

Two lines are worth reading rather than skimming:

- **`the browser video probe endpoint answers`** should say either how many endpoints answered or, on a
  stock install, "no browsers are configured under `focus.videoBrowsers`, so video can never break
  a block". That second message is telling you something true and easy to miss: video detection is
  off until you list a browser started with `--remote-debugging-port`. Note the name: it asks
  whether the endpoint is there, not whether a play state can be read through it. That is
  `node test/video-breaker.pw.mjs`, which drives a real browser playing a real file.
- **`the reading rung's preconditions hold`** reports on the browser, the port and the session
  separately, and is named for what it does. It can be green while the book still does not open,
  because a browser being installed is not the same as a browser that works; step 8 is the real
  test.

## 5. The panel, and the reading layout

```bash
open http://localhost:7420/panel
```

- The page area should fill the window. Every other control lives behind the single **⋯** button,
  top right, except the page-turn pager, which fades in when you move the mouse or tab into it.
- Open **⋯**. The rung buttons, the book title, the progress bar, the note, the actions, the
  companions banner and the status line should all be inside it, and **Close** should be reachable
  however far you scroll.
- Press **Escape**. Everything should go back where it was, and focus should return to **⋯**.
- Press a rung button *from inside the open menu*. The header and footer must come back rather
  than vanish; if the rung ladder disappears with no way back, that is the defect fixed in
  `9e0f453`.

## 6. Stars

Open **⋯**, then **Star calendar**.

- The header names the month and a count. Every open re-asks the daemon, so a star earned while the
  panel is open shows up on the next open rather than on a reload.
- Click a star. It should reveal the wall-clock start and end of the block that earned it, in your
  own local time, twenty five minutes apart.
- **Switch to day view** should land on today, and the arrows should step by day. Paging to another
  month and reopening should bring you back to this one.

To check the times against the record itself:

```bash
tail -3 logs/stars.jsonl
```

Each line should carry your local offset, `-07:00` or similar, not a `Z`. A `Z` line is from before
commit `14520ee` and will sit on the wrong day in the calendar.

## 7. The latency indicator

With the panel open on the reading rung, submit a prompt to Claude Code in another window.

**Expect** a chip in the top left counting up, then clearing when the answer lands, and a separate
"Your agent answered" notice beside it rather than on top of it. Two prompts in flight are two
independent clocks.

```bash
curl -s -H "x-interstice-token: $(cat logs/control-token)" \
  http://127.0.0.1:7420/api/focus | python3 -m json.tool
```

`block.phase` should be `running`, `block.breakers` should list all three, and `latency.waiting`
should hold anything currently in flight.

## 8. The book

```bash
curl -s --max-time 120 -X POST -H "x-interstice-token: $(cat logs/control-token)" \
  -H 'content-type: application/json' -d '{}' http://127.0.0.1:7420/api/reading/view \
  | python3 -m json.tool | head -20
```

**Expect** `ok: true` and a `seq`. If `signedOut` is true, the reader is working and your Amazon
session has expired: open the panel's reading rung and press **Sign in to Amazon in Chrome**, which
opens a visible window and closes itself once you are in.

**If the error says a browser never opened its debugging port**, it will now name every browser it
tried. Some Chrome builds refuse to start the DevTools server at all; installing Brave or Chromium
is enough, and Interstice will pick whichever answers.

## 9. What is not verified here

- **Three consecutive cold starts opening the book at the synced page** (goal-loop item 1.7) needs a
  live Amazon session. Once you have signed in once, it becomes checkable.
- **Video forfeiting a block** is exercised end to end by `node test/video-breaker.pw.mjs`, against
  a real browser playing a real file. Doing it by hand needs a browser started with
  `--remote-debugging-port` and listed in `focus.videoBrowsers`, which no stock install has.
- The recording in `docs/demo/` shows five of the six behaviours the goal loop asks for.
  `docs/demo/README.md` says which one is missing and why.
