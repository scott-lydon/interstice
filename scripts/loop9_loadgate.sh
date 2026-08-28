#!/usr/bin/env bash
# Loop 9 item 0.9: refuse to start a heavy build when the machine cannot take it.
#
# One heavy build at a time is a standing rule on this machine, and it has teeth: three
# concurrent compiles once drove the load average past 50 and starved the host until the
# shell surfaces stopped answering. This gate exits non-zero rather than queueing, so the
# caller decides whether to wait; a gate that blocks forever is one people work around.
set -uo pipefail

cores=$(sysctl -n hw.ncpu)
load1=$(uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/' | tr -d ' ')

fail=0

# 1. Load average over the last minute, against the core count.
if awk -v l="$load1" -v c="$cores" 'BEGIN { exit !(l < c) }'; then
    printf 'load       OK      %.2f over 1 min, %d cores\n' "$load1" "$cores"
else
    printf 'load       BUSY    %.2f over 1 min, %d cores\n' "$load1" "$cores"
    fail=1
fi

# 2. Low power mode throttles compiles badly and silently.
lpm=$(pmset -g 2>/dev/null | awk '/lowpowermode/ {print $2}')
if [[ "${lpm:-0}" == "0" ]]; then
    echo "lowpower   OK      off"
else
    echo "lowpower   ON      compiles will be throttled"
    fail=1
fi

# 3. Any other heavy build already running. Matched on the real binaries rather than
#    on wrapper names, because `gradlew` exits immediately and leaves a JVM behind.
busy=""
for pat in "xcodebuild" "swift-frontend" "swift-build" "GradleDaemon" "gradle-launcher" "webpack" "vite build"; do
    if pgrep -fl "$pat" 2>/dev/null | grep -qv pgrep; then
        busy="$busy $pat"
    fi
done
if [[ -z "$busy" ]]; then
    echo "builds     OK      none running"
else
    echo "builds     BUSY   $busy"
    fail=1
fi

echo
if (( fail )); then
    echo "REFUSED: the machine cannot take another heavy build right now." >&2
    exit 1
fi
echo "CLEAR: safe to start one heavy build."
