#!/usr/bin/env bash
# Loop 9 item 0.3: prove every tool this loop invokes exists BEFORE it is needed.
#
# Exits non-zero if any row is missing, because a preflight that reports a gap and
# still exits 0 is a preflight nobody has to read.
#
# JAVA_HOME and ANDROID_HOME are exported here for the same reason loop 6 needed them:
# the toolchain is installed but a plain shell does not see it, which reads as absent.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:$PATH"

AND="/Users/scottlydon/Developer/akin-android"
missing=0
printf '%-22s %-58s %s\n' TOOL PATH VERSION
printf '%-22s %-58s %s\n' ---- ---- -------

row() {
    local name="$1" path="$2" ver="$3"
    if [[ -z "$path" ]]; then
        printf '%-22s %-58s %s\n' "$name" "MISSING" "-"
        missing=$((missing + 1))
    else
        printf '%-22s %-58s %s\n' "$name" "$path" "${ver:-unknown}"
    fi
}

row node       "$(command -v node    || true)" "$(node --version 2>/dev/null)"
row npm        "$(command -v npm     || true)" "$(npm --version 2>/dev/null)"
row swift      "$(command -v swift   || true)" "$(swift --version 2>&1 | head -1 | sed -E 's/.*version ([0-9.]+).*/\1/')"
row xcodebuild "$(command -v xcodebuild || true)" "$(xcodebuild -version 2>/dev/null | head -1)"
row psql       "$(command -v psql || ls /Applications/Postgres.app/Contents/Versions/latest/bin/psql 2>/dev/null || true)" "$(/Applications/Postgres.app/Contents/Versions/latest/bin/psql --version 2>/dev/null | awk '{print $3}')"
row gh         "$(command -v gh      || true)" "$(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
row claude     "$(command -v claude  || true)" "$(claude --version 2>/dev/null | head -1)"
row python3    "$(command -v python3 || true)" "$(python3 --version 2>/dev/null | awk '{print $2}')"
row java       "$(command -v java    || true)" "$(java -version 2>&1 | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
row gradlew    "$([[ -x $AND/gradlew ]] && echo "$AND/gradlew" || true)" "wrapper"
row safegit    "$([[ -x $HOME/bin/safegit ]] && echo "$HOME/bin/safegit" || true)" "script"

# The reader drives a Chromium-family browser; interstice launches whichever it finds.
chrome=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
         "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
    [[ -x "$c" ]] && { chrome="$c"; break; }
done
row chromium-family "$chrome" "$([[ -n $chrome ]] && "$chrome" --version 2>/dev/null | awk '{print $NF}')"

echo
if (( missing > 0 )); then
    echo "FAIL: $missing tool(s) missing." >&2
    exit 1
fi
echo "PASS: every tool this loop invokes is present."
