#!/bin/sh
# Interstice: Claude Code UserPromptSubmit hook.
#
# This runs synchronously in front of your turn, so it must be fast and must never
# fail in a way that blocks you. It writes one line to a FIFO-ish log the daemon
# watches and exits. No node startup, no network, no JSON parsing.
#
# Target: well under 50ms. Measured by test/hook-latency.test.js.

LOG_DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"
mkdir -p "$LOG_DIR" 2>/dev/null

TS=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
printf '{"event":"submit","surface":"claude-code","sessionId":"%s","ts":%s,"via":"hook"}\n' \
  "${CLAUDE_SESSION_ID:-unknown}" "$TS" >> "$LOG_DIR/hook-events.jsonl"

exit 0
