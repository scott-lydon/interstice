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

## Measured on real usage

Parsed from existing transcripts before a line was written (timestamps only):

| Surface | Prompts | Median turn | >=25s | >=3m | >=12m |
|---|---|---|---|---|---|
| Cowork | 4,731 | 3m 54s | 92.4% | 56.3% | 23.2% |
| Claude Code | 1,883 | 53s | 63.8% | 29.5% | 11.9% |

This is not a system that fires twice a day.

---

## Install

Requires macOS and Node 20 or newer. There are no npm dependencies.

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
| **Deliver** | Anki is driven straight to a card, not a deck list. Kindle opens to your book. Nothing is ever quit, hidden or closed. |
| **Reclaim** | Agent finishes or asks for you: your window comes forward, the activity drops behind, the notification says which session and why. |
| **Learn** | Every gap is logged and rendered at `http://localhost:7420`. |

### The ladder

Default order, editable in one file:

1. **Flashcards** if any card is due
2. **Reading** if a book is in progress
3. **Queue next prompt** in a focused capture window
4. **To-do list**, last, because writing one is itself decision heavy

A rung with no work falls through to the next. The router never delivers you into an
empty deck.

### Two keys

- **Advance** moves you to the next rung, wrapping at the end. It is a *next*, not a
  menu, so there is still nothing to choose between.
- **Stand down** ends routing for the rest of that gap.

Both are logged, so the record shows whether you are escaping the router or the work.

## Commands

```
interstice doctor          Prove every dependency. Exits non-zero on any failure.
interstice install         Write config, install hooks and the LaunchAgent.
interstice start [--foreground]
interstice stop
interstice status          Current gap, armed rung, cooldown, counts.
interstice advance         Move to the next rung (also bound to a hotkey).
interstice standdown [--day]
interstice dashboard       Open the log UI in your browser.
interstice simulate <sec>  Drive a synthetic gap of N seconds. Debug route.
```

## Debug route

Real gaps depend on an agent actually running, which makes some states slow to reach.
`interstice simulate` and the `/debug` page drive the daemon into any state directly:
arm a gap, force any rung, trigger reclaim, fire a veto. Nothing there fabricates log
data; simulated gaps are tagged `synthetic: true` and excluded from the statistics.

## Configuration

`config/interstice.config.json`, created by `install` from the checked in defaults.

```json
{
  "arm": 25, "mid": 180, "long": 720, "cooldown": 90,
  "ladder": ["flashcards", "reading", "queue_prompt", "todo"],
  "focusMode": "take",
  "idleVetoMs": 4000
}
```

## Privacy

Interstice reads message *timestamps and structure* from agent transcripts. It never
reads, stores, transmits or logs the content of your prompts or the agent's replies. All
data stays on your machine. There is no network egress apart from AnkiConnect on
localhost.

## License

MIT. See [LICENSE](LICENSE).
