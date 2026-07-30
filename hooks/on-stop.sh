#!/bin/sh
# Interstice: Claude Code Stop hook. Closes the gap the submit hook opened.
# Same constraints as on-submit.sh: fast, silent, never blocks the turn.

LOG_DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"
mkdir -p "$LOG_DIR" 2>/dev/null

TS=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
printf '{"event":"end","reason":"complete","surface":"claude-code","sessionId":"%s","ts":%s,"via":"hook"}\n' \
  "${CLAUDE_SESSION_ID:-unknown}" "$TS" >> "$LOG_DIR/hook-events.jsonl"

exit 0
