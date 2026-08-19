#!/bin/sh
# Interstice: Claude Code Stop hook. Closes the gap the submit hook opened.
# Same constraints as on-submit.sh: fast, silent, never blocks the turn.

LOG_DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"
mkdir -p "$LOG_DIR" 2>/dev/null

# BSD date on macOS does not implement %3N: `date +%s%3N` emits the seconds followed by a
# literal "3N", which made every record invalid JSON. It never failed, so the `||` fallback
# never fired and 6111 events logged as unparseable. Ask python for the milliseconds.
TS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo 0)
printf '{"event":"end","reason":"complete","surface":"claude-code","sessionId":"%s","ts":%s,"via":"hook"}\n' \
  "${CLAUDE_SESSION_ID:-unknown}" "$TS" >> "$LOG_DIR/hook-events.jsonl"

exit 0
