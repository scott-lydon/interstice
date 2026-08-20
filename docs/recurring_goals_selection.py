#!/usr/bin/env python3
"""Select which Recurring_goals rules apply to THIS repo, and say why for every one.

Why this exists
---------------
`Recurring_goals` holds 643 atomic rules across 19 sheets. Running all of them
against Interstice would spend most of its effort on Swift, Python, React and
Gauntlet-assignment rules that cannot possibly apply to a dependency-free Node
ESM tool with a single HTML panel. Selection is the point, and selection has to
be auditable rather than asserted, so it lives in code and emits a manifest.

Contract
--------
Every (sheet, applies_to) pair present in the data MUST appear in DECISIONS.
An unclassified pair is a hard error naming the sheet, the exact applies_to
string, the row count and the row ids, because a silently dropped rule is
indistinguishable from a rule that was considered and rejected.

Verdicts
--------
include      the rule can be evaluated against this repo as it stands
conditional  the rule applies only if a named precondition holds; the worker
             must record which way it resolved, per row
exclude      the rule cannot apply here, for the stated reason
"""

import csv
import glob
import os
import sys
from collections import Counter, defaultdict

ROOT = os.environ.get("RECURRING_GOALS_ROOT", "/Users/scottlydon/Developer/Recurring_goals")
TARGET = os.environ.get("TARGET_REPO", "/Users/scottlydon/Developer/interstice")

# --- Facts about the target, probed rather than assumed -----------------------

# Directories that hold the product itself. The language probes scan ONLY these.
# Scanning the whole repo would let tooling under docs/ answer a question about the
# product: this very file is Python, and an unscoped `**/*.py` probe reported
# "python: True" for a repo that ships no Python. A probe that can see itself is
# not measuring the thing it claims to measure.
SOURCE_DIRS = ("lib", "bin", "test", "web", "hooks", "launchd")


def probe_target(target):
    """Return the boolean facts the decision table depends on.

    Each fact is a filesystem question, so the table below is falsifiable: if
    the repo grows a `src/` directory or a Swift file, the fact flips and the
    affected rules change verdict without anyone editing prose.
    """
    def has(pattern):
        """True if `pattern` matches anything inside a source directory."""
        for d in SOURCE_DIRS:
            base = os.path.join(target, d)
            if not os.path.isdir(base):
                continue
            if glob.glob(os.path.join(base, pattern), recursive=True):
                return True
        return False

    present = [d for d in SOURCE_DIRS if os.path.isdir(os.path.join(target, d))]
    if not present:
        raise SystemExit(
            f"FATAL: none of the expected source directories exist under {target!r}.\n"
            f"  Looked for: {', '.join(SOURCE_DIRS)}\n"
            f"  Every language fact would silently read False, so every language-scoped\n"
            f"  rule would be dropped for the wrong reason.\n"
            f"  Fix: set TARGET_REPO to the repo root, or update SOURCE_DIRS if the\n"
            f"  project has been restructured."
        )
    return {
        "swift": has("**/*.swift"),
        "python": has("**/*.py"),
        "react": has("**/*.jsx") or has("**/*.tsx"),
        "js": has("**/*.js"),
        "html": has("**/*.html"),
        "server_dir": os.path.isdir(os.path.join(target, "server")),
        "src_dir": os.path.isdir(os.path.join(target, "src")),
        "migrations": has("**/migrations"),
        "website_index": os.path.exists(os.path.join(target, "website", "index.html")),
        "claude_design_bundle": os.path.isdir(os.path.join(target, "design", "claude-design")),
        "gauntlet_assignment": False,   # Interstice is a personal tool, not a graded submission
        "icloud_synced": False,         # lives in ~/Developer, which is not iCloud-synced
        "graphified": os.path.isdir(os.path.join(target, ".graphify")),
    }

# --- The decision table -------------------------------------------------------
# Keyed by (sheet, applies_to). Value is (verdict, reason).

I, C, X = "include", "conditional", "exclude"

NO_SWIFT = "no Swift source in this repo"
NO_PY = ("the only Python in the repo is docs/recurring_goals_selection.py, the "
         "manifest generator itself; it is audit tooling, not product source, and "
         "the product ships no Python. Scoped out deliberately, not absent")
NO_REACT = ("the glob matches this repo's .js files, and most rules on the React/Next "
            "sheet presume a React component tree, Server Actions, RSC nesting, or a "
            "bundler, none of which this repo has. The plain-JavaScript and plain-web "
            "subset of the sheet is restored row by row in ROW_OVERRIDES")
NOT_ASSIGNMENT = "Interstice is a personal tool, not a Gauntlet assignment submission"
CONVERSATIONAL = ("governs how the agent writes its replies, not anything in the "
                  "codebase; remains in force continuously and is not a code-audit row")

DECISIONS = {
    ("Assignments", "assignment repositories"): (X, NOT_ASSIGNMENT),
    ("Assignments", "assignment responses"): (X, NOT_ASSIGNMENT),
    ("Assignments", "Gauntlet repositories"): (X, NOT_ASSIGNMENT),
    ("Assignments", "every project repository"): (I, "general repository hygiene, applies to any repo"),
    ("Assignments", "assignment deliverables"): (X, NOT_ASSIGNMENT),
    ("Assignments", "the Gauntlet portal"): (X, NOT_ASSIGNMENT),
    ("Assignments", "assignment submissions"): (X, NOT_ASSIGNMENT),

    ("Code/JavaScript_TypeScript_Development", "**/*.{ts,tsx,js,jsx,mts,cts}"):
        (I, "the entire lib/, bin/ and test/ tree is ES-module JavaScript"),

    ("Code/Python_Development", "**/*.py"): (X, NO_PY),

    ("Code/React_NextJS_Development", "**/*.{ts,tsx,js,jsx}"): (X, NO_REACT),

    ("Code/Swift_Development", "**/*.swift"): (X, NO_SWIFT),
    ("Code/Swift_Development", "all source files"): (X, NO_SWIFT + " (sheet is Swift-specific)"),
    ("Code/Swift_Development", "server-side Swift (Vapor) **/*.swift"): (X, NO_SWIFT),
    ("Code/Swift_Development", "**/*UITests*/**/*.swift"): (X, NO_SWIFT),
    ("Code/Swift_Development", "new projects and new standalone components"): (X, NO_SWIFT),

    ("Code/Testing_and_Coverage", "assignment repositories"): (X, NOT_ASSIGNMENT),
    ("Code/Testing_and_Coverage", "**/*UITests*/**, **/e2e/**"):
        (X, "no XCUITest or e2e directory; Playwright drives run from test/ instead"),
    ("Code/Testing_and_Coverage", "coverage campaigns"): (I, "phase 8.2 is a per-file coverage campaign"),
    ("Code/Testing_and_Coverage", "filtered test runs"): (I, "node --test is run filtered during iteration"),
    ("Code/Testing_and_Coverage", "**/tests/**, **/*test*"): (I, "test/ holds 20 suites"),
    ("Code/Testing_and_Coverage", "solution-finding features"):
        (I, "the reader failure classifier in phase 1.2 is exactly this"),
    ("Code/Testing_and_Coverage",
     "checklists, goal loops, gate scripts, and any Verify line a person or an agent is "
     "expected to trust"):
        (I, "this goal loop is the artifact the rule describes"),

    ("Code/Universal", "**/* (any language)"): (I, "language-neutral by construction"),

    ("Deployment", "the deployed system"):
        (C, "Interstice 'deploys' as a macOS LaunchAgent on one machine, not a server; "
            "each row must record whether its notion of deployment maps onto a LaunchAgent"),
    ("Deployment", "server/**"): (X, "no server/ directory; lib/server.js is a local HTTP surface, not a deployed service tree"),
    ("Deployment", "src/**"): (X, "no src/ directory"),
    ("Deployment", "**/migrations/**"): (X, "no database, therefore no migrations"),
    ("Deployment", "**/*.plist, crontab"): (I, "the LaunchAgent plist written by install.js"),
    ("Deployment", "~/.claude/skills/**, ~/.claude/plugins/**"): (X, "this loop ships no skill or plugin"),

    ("Design/Data_Visualization", "charts and dashboards"): (I, "the star calendar and the existing dashboard at :7420"),
    ("Design/Data_Visualization", "dashboards"): (I, "web/dashboard.html"),

    ("Design/Design_Fidelity", "projects with a Claude Design handoff bundle"):
        (X, "no design/claude-design bundle; the design phase here uses frontend-design and design-reference"),
    ("Design/Design_Fidelity", "design deliverables"): (I, "phase 2A.4 produces docs/design-immersive-reading.html"),

    ("Design/Visual_Design", "user interfaces"): (I, "web/panel.html is the product's whole interface"),
    ("Design/Visual_Design", "website/index.html"): (X, "no website/ directory"),
    ("Design/Visual_Design", "website/index.html, architecture diagrams"): (X, "no website/ directory and no architecture diagrams"),
    ("Design/Visual_Design", "all Mermaid diagrams"): (X, "no Mermaid diagrams in this repo"),
    ("Design/Visual_Design", "ARCHITECTURE.md, website/index.html"): (X, "neither file exists"),
    ("Design/Visual_Design", "**/*.{html,tsx,jsx}"): (I, "three HTML surfaces under web/"),
    ("Design/Visual_Design", "design tokens"):
        (C, "applies only if phase 2 introduces a token layer; record which way it resolved"),

    ("Machine_Safety", "the local machine"): (I, "the loop runs builds and a browser on the operator's Mac"),
    ("Machine_Safety", "every deletion"): (I, "log pruning and reader-profile cleanup delete files"),
    ("Machine_Safety", "new and moved projects"): (X, "Interstice already exists at its final location"),
    ("Machine_Safety", "iCloud-managed paths"): (X, "~/Developer is not iCloud-synced"),
    ("Machine_Safety", "graphified projects"): (X, "no .graphify directory"),

    ("Process/Agent_Behavior", "every response"): (X, CONVERSATIONAL),
    ("Process/Agent_Behavior", "the session's work product"): (I, "the diff and artifacts this loop produces"),
    ("Process/Agent_Behavior", "the diff produced this session"): (I, "directly checkable against git diff"),
    ("Process/Agent_Behavior", "every session"): (I, "session-level process rules the loop must satisfy"),
    ("Process/Agent_Behavior", "every multi-step task"): (I, "this loop is a multi-step task"),
    ("Process/Agent_Behavior", "**/*GOAL_LOOP*.md, **/tasks.md, **/CHECKLIST*.md"):
        (I, "this file matches the glob"),
    ("Process/Agent_Behavior", "every session over 30 turns"): (I, "this loop will exceed 30 turns"),
    ("Process/Agent_Behavior", "every session that starts background work"):
        (I, "the blocker monitor and the daemon are background work"),
    ("Process/Agent_Behavior", "tools, skills, scripts, and pipelines"): (I, "Interstice is a tool"),
    ("Process/Agent_Behavior", "every recommendation"): (X, CONVERSATIONAL),
    ("Process/Agent_Behavior", "every network failure"): (I, "the reader and CDP paths fail over the network"),
    ("Process/Agent_Behavior", "every session that fixes or builds something"): (I, "phases 1 through 5 fix and build"),
    ("Process/Agent_Behavior", "every session using Chrome automation"):
        (I, "the reader and the video probe both drive Chrome"),
    ("Process/Agent_Behavior", "every session that creates a skill"): (X, "this loop creates no skill"),

    # Process/Communication governs how the agent WRITES ITS REPLIES. Those rules stay
    # in force for every message of this loop; they are simply not row-audit targets,
    # because there is nothing in the repository for a worker to inspect against them.
    ("Process/Communication", "every guide"):
        (C, "the closing block produces a manual verification checklist, which is a guide; "
            "applies to that artifact only"),
    ("Process/Communication", "every response"): (X, CONVERSATIONAL),
    ("Process/Communication", "every response mentioning the codebase"): (X, CONVERSATIONAL),
    ("Process/Communication", "every response that creates content"): (X, CONVERSATIONAL),
    ("Process/Communication", "every explanatory response"): (X, CONVERSATIONAL),
    ("Process/Communication", "every re-explanation"): (X, CONVERSATIONAL),
    ("Process/Communication", "every response with timing"): (X, CONVERSATIONAL),
    ("Process/Communication", "every health-advice response"):
        (X, "this loop produces no health advice"),
    ("Process/Communication", "App Store rejection responses"):
        (X, "Interstice is not shipped through the App Store"),
    ("Process/Communication", "spoken deliverables"):
        (X, "this loop produces no spoken deliverable"),

    ("Process/Data_Integrity", "the session's work product"): (I, "star records and measured coverage must be real"),
    ("Process/Data_Integrity", "the whole project and every response"): (I, "project-wide integrity rule"),
    ("Process/Data_Integrity", "**/*.{py,swift,ts,tsx,js,jsx,rb,go}"): (I, "the .js arm of the glob matches"),
    ("Process/Data_Integrity", "**/*.{py,swift,ts,tsx,js,jsx,sql}"): (I, "the .js arm of the glob matches"),
    ("Process/Data_Integrity", "**/tests/**"): (I, "test/ holds 20 suites"),
    ("Process/Data_Integrity", "the whole project"): (I, "project-wide integrity rule"),
    ("Process/Data_Integrity", "every git repository touched"): (I, "this repo is touched"),
    ("Process/Data_Integrity", "every git stash"): (I, "phase 1.3 stashes to prove a test fails on main"),
    ("Process/Data_Integrity", "**/*.md carrying quoted product copy or file:line citations"):
        (I, "this goal loop cites file:line throughout"),

    ("Project_Structure", "every project"): (I, "structural rules apply to any repo"),
    ("Project_Structure", "project locations"): (I, "the repo's location is load bearing for the LaunchAgent"),
    ("Project_Structure", "new projects"): (X, "Interstice is an existing project"),
    ("Project_Structure", "active goal loops"): (I, "this loop is active"),
    ("Project_Structure", "tools, skills, scripts, and pipelines"): (I, "Interstice is a tool"),

    ("Security_and_Secrets", "every credential need"): (I, "the Amazon reader session in phase 0.2"),
    ("Security_and_Secrets", "every broker error"): (I, "Secrets Driver is used in phase 0.2"),
    ("Security_and_Secrets", "**/*"): (I, "repo-wide"),
    ("Security_and_Secrets", "**/*.{ts,tsx,js,jsx}"): (I, "the .js arm matches; this row is a secrets rule, not a React rule"),
    ("Security_and_Secrets", "server/**, app/**"): (X, "neither directory exists"),

    ("UX", "**/*.{tsx,jsx,ts,js,html,vue,svelte}"): (I, "web/panel.html plus the JS that drives it"),
    ("UX", "the whole project"): (I, "project-wide UX rule"),
    ("UX", "all outward-facing text"): (I, "panel copy, failure remedies, forfeit reasons"),
    ("UX", "all user-facing explanatory text"): (I, "the 'why' strings the panel already renders"),

    ("User_Facing_Copy",
     "every user-facing surface in the target: rendered screens and flows, plus display strings in "
     "**/*.{strings,stringsdict,swift,tsx,jsx,ts,js,html,vue,svelte} and any email, push notification, "
     "or marketing asset"):
        (I, "the panel is a user-facing surface and its display strings live in matching files"),
}

# --- Per-row overrides ---------------------------------------------------------
# DECISIONS is keyed by (sheet, applies_to), and applies_to is a PATH GLOB. That is the
# wrong question for a rule whose normative text is about a KIND OF SYSTEM rather than a
# kind of file. An adversarial review of the exclusions on 2026-08-19 found eight such
# rules: `server/**` excluded the daemon-restart rule from a project that IS a daemon,
# `**/*UITests*/**` excluded a UI-test-timeout rule from a project with five Playwright
# UI specs, and so on. The pair verdict is still the default; this table overrides it for
# named rows, each with the evidence in THIS repo that forced the change.
#
# Rule for adding a row here: quote the rule BODY (not its glob) and name the concrete
# file or process in this repo that the body has a referent in.

ROW_OVERRIDES = {
    # Deployment: the glob says server/**, but the rule bodies are about a long-lived
    # process loaded at startup, which bin/interstice.js start --foreground is.
    "DEP-005": (I, "the rule body says 'anything loaded at startup'; the Interstice daemon "
                   "is exactly that, and lib/install.js drives launchctl unload/load"),
    "DEP-019": (I, "lib/server.js dispatches /api/* routes alongside static HTML from one "
                   "handler, which is the hazard shape; no test asserts its content-type"),

    # Testing: excluded on a directory name while conceding the subject exists.
    "TC-005": (I, "five Playwright UI specs live in test/*.pw.mjs with no playwright.config.js "
                  "and no CI timeout branch, so the rule has a real target here"),

    # Security: the Incorrect shape is literally present in lib/server.js.
    "SEC-005": (I, "lib/server.js declares module-scope mutable request state "
                   "(companionOverrides) that later requests read back"),

    # Project structure: the detect clause runs against any project, new or not.
    "PS-002": (I, "the detect clause asks whether the project appears in the Atlas index, "
                  "which is answerable for an existing project too"),

    # Design fidelity: docs/design-immersive-reading.html is canonical for work that has
    # not landed yet, so the drift-direction rules have a live referent during Phase 2C.
    "DF-005": (C, "applies if docs/design-immersive-reading.html is treated as the canonical "
                  "design artifact; record whether the panel drifted from it"),
    "DF-006": (C, "same precondition as DF-005: does a canonical design artifact exist here"),
}

# React/Next sheet: the blanket reason ('every rule presumes a React component tree') is
# false for a plain-JavaScript subset whose rule sentence names no React construct and
# whose SCOPE line reads 'the target codebase'. Those rows are restored. Rows that are
# genuinely Next-bound (Server Actions, API routes, RSC nesting, JSX conditional
# rendering) or bundler-bound (this repo has no bundler) stay excluded.
REACT_FREE_ROWS = [
    "RN-ASYNC-DEPENDENCIES", "RN-ASYNC-PARALLEL",
    "RN-CLIENT-LOCALSTORAGE-SCHEMA",
    "RN-JS-BATCH-DOM-CSS", "RN-JS-CACHE-FUNCTION-RESULTS", "RN-JS-CACHE-PROPERTY-ACCESS",
    "RN-JS-CACHE-STORAGE", "RN-JS-COMBINE-ITERATIONS", "RN-JS-EARLY-EXIT",
    "RN-JS-FLATMAP-FILTER", "RN-JS-INDEX-MAPS", "RN-JS-LENGTH-CHECK-FIRST",
    "RN-JS-MIN-MAX-LOOP", "RN-JS-REQUEST-IDLE-CALLBACK", "RN-JS-SET-MAP-LOOKUPS",
    "RN-RENDERING-ANIMATE-SVG-WRAPPER", "RN-RENDERING-CONTENT-VISIBILITY",
    "RN-RENDERING-SCRIPT-DEFER-ASYNC", "RN-RENDERING-SVG-PRECISION",
    "RN-SERVER-HOIST-STATIC-IO",
]
for _rid in REACT_FREE_ROWS:
    ROW_OVERRIDES[_rid] = (I, "plain-JavaScript or plain-web rule: its rule sentence names no "
                              "React construct and its applies_to glob matches this repo's .js "
                              "and .html files")


def load_rows(root):
    """Read every rows.csv under root, tagged with its sheet name.

    Note for anyone counting rows: `wc -l` overcounts badly here, because the
    agent_prompt column contains embedded newlines. Always count with a CSV
    reader. The true total is 643, not the ~5,800 lines the files occupy.
    """
    out = []
    pattern = os.path.join(root, "**", "rows.csv")
    paths = sorted(glob.glob(pattern, recursive=True))
    if not paths:
        raise SystemExit(
            f"FATAL: no rows.csv found under {root!r}.\n"
            f"  Expected the Recurring_goals tree with one rows.csv per sheet.\n"
            f"  Fix: set RECURRING_GOALS_ROOT to the correct path, or confirm the tree "
            f"still lives at the documented location."
        )
    for p in paths:
        sheet = os.path.relpath(p, root).replace(os.sep + "rows.csv", "")
        with open(p, newline="") as fh:
            for r in csv.DictReader(fh):
                r["_sheet"] = sheet
                out.append(r)
    return out


def classify(rows):
    """Apply DECISIONS to every row, erroring loudly on anything unclassified."""
    unknown = defaultdict(list)
    verdicts = []
    for r in rows:
        key = (r["_sheet"], (r.get("applies_to") or "").strip())
        if key not in DECISIONS:
            unknown[key].append(r.get("row_id", "<no row_id>"))
            continue
        verdict, reason = DECISIONS[key]
        # A named row beats its (sheet, applies_to) pair: see ROW_OVERRIDES.
        rid = (r.get("row_id") or "").strip()
        if rid in ROW_OVERRIDES:
            verdict, reason = ROW_OVERRIDES[rid]
        verdicts.append((r, verdict, reason))
    if unknown:
        lines = [
            "FATAL: Recurring_goals rows are not covered by the selection table.",
            "",
            "A rule that is neither included nor explicitly excluded has been silently",
            "dropped, which is indistinguishable from a rule that was never considered.",
            "Add each pair below to DECISIONS with a verdict and a reason.",
            "",
        ]
        for (sheet, applies), ids in sorted(unknown.items()):
            lines.append(f"  sheet       : {sheet}")
            lines.append(f"  applies_to  : {applies!r}")
            lines.append(f"  rows        : {len(ids)}  ({', '.join(ids[:8])}"
                         f"{', …' if len(ids) > 8 else ''})")
            lines.append("")
        raise SystemExit("\n".join(lines))
    return verdicts


def main():
    facts = probe_target(TARGET)
    rows = load_rows(ROOT)
    verdicts = classify(rows)

    counts = Counter(v for _, v, _ in verdicts)
    by_sheet = defaultdict(Counter)
    for r, v, _ in verdicts:
        by_sheet[r["_sheet"]][v] += 1

    print("# Recurring_goals selection for Interstice")
    print()
    print(f"Source tree : `{ROOT}`")
    print(f"Target repo : `{TARGET}`")
    print(f"Total rules : {len(rows)} across {len(by_sheet)} sheets "
          f"(counted with a CSV reader; `wc -l` overcounts because agent_prompt "
          f"contains newlines)")
    print()
    print(f"**Selected {counts['include']} · conditional {counts['conditional']} · "
          f"excluded {counts['exclude']}**")
    print()
    print("## Probed facts about the target")
    print()
    print("| fact | value |")
    print("|---|---|")
    for k, v in sorted(facts.items()):
        print(f"| `{k}` | {v} |")
    print()
    print("## Per sheet")
    print()
    print("| sheet | rules | include | conditional | exclude |")
    print("|---|---:|---:|---:|---:|")
    for sheet in sorted(by_sheet):
        c = by_sheet[sheet]
        print(f"| {sheet} | {sum(c.values())} | {c['include']} | "
              f"{c['conditional']} | {c['exclude']} |")
    print(f"| **TOTAL** | **{len(rows)}** | **{counts['include']}** | "
          f"**{counts['conditional']}** | **{counts['exclude']}** |")
    print()
    print("## Exclusions, with the reason for each")
    print()
    seen = {}
    for r, v, reason in verdicts:
        if v == "exclude":
            seen.setdefault((r["_sheet"], (r.get("applies_to") or "").strip(), reason), 0)
            seen[(r["_sheet"], (r.get("applies_to") or "").strip(), reason)] += 1
    print("| sheet | applies_to | rules dropped | reason |")
    print("|---|---|---:|---|")
    for (sheet, applies, reason), n in sorted(seen.items(), key=lambda kv: -kv[1]):
        print(f"| {sheet} | `{applies[:60]}` | {n} | {reason} |")
    print()
    print("## Conditional rules (each worker must record how it resolved)")
    print()
    print("| sheet | applies_to | rules | precondition |")
    print("|---|---|---:|---|")
    cseen = {}
    for r, v, reason in verdicts:
        if v == "conditional":
            k = (r["_sheet"], (r.get("applies_to") or "").strip(), reason)
            cseen[k] = cseen.get(k, 0) + 1
    for (sheet, applies, reason), n in sorted(cseen.items(), key=lambda kv: -kv[1]):
        print(f"| {sheet} | `{applies[:60]}` | {n} | {reason} |")
    print()
    print("## Selected row ids")
    print()
    sel = defaultdict(list)
    for r, v, _ in verdicts:
        if v in ("include", "conditional"):
            sel[r["_sheet"]].append(r.get("row_id", "?"))
    for sheet in sorted(sel):
        print(f"- **{sheet}** ({len(sel[sheet])}): {', '.join(sorted(sel[sheet]))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
