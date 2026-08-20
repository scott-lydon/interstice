#!/usr/bin/env python3
"""Route the selected rules into worker batches, by target locality.

Batching axis is the file cluster a rule targets, not the rule itself: a worker that has
already read a page can evaluate forty UX rules against it in one pass, whereas one agent
per row would read the same file 346 times.

Target-agnostic (PS-007). This script used to hardcode one repo's file lists as the batch
localities, including `web/learn.html`, a file that has never existed here, so a worker was
sent to read a page that was not there and the batch label was a claim nobody had checked.
The localities are now globbed out of the target repo at run time and clustered by
directory, and the target is a required argument rather than a default pointing at one
machine's home directory.

  TARGET_REPO=/path/to/repo python3 route.py
  python3 route.py --target /path/to/repo
"""
import argparse, collections, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Trees that are not the product: dependencies, build output, and the audit's own paperwork.
# `docs` is excluded for the same reason recurring_goals_selection.py excludes it from its
# language probes: this very file lives there, and a router that routes rules at its own
# source is measuring itself.
SKIP_DIRS = {
    ".git", "node_modules", "docs", "dist", "build", "coverage",
    ".venv", "venv", "__pycache__", ".next", "vendor",
}

WEB_EXTS = {".html", ".htm"}
CODE_EXTS = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"}


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--target",
        default=os.environ.get("TARGET_REPO"),
        help="the repo the rules are being evaluated against (or set TARGET_REPO)",
    )
    args = ap.parse_args(argv)
    if not args.target:
        ap.error("no target repo: pass --target /path/to/repo or set TARGET_REPO")
    if not os.path.isdir(args.target):
        ap.error(f"--target {args.target!r} is not a directory")
    args.target = os.path.abspath(args.target)
    return args


def tracked_files(target):
    """What the repo says it contains, or None when the target is not a git checkout.

    Version control is the only target-agnostic answer to "which files are the product". A plain
    directory walk is not: this repo keeps two live Chrome profiles under `logs/`, and walking it
    routed 5,000 vendored extension files as if they were the product, which is a worse wrong
    answer than the hardcoded list this script is replacing. `logs/` is in .gitignore, so git
    already knows. Any repo that has an opinion about its own contents gets it honoured here.
    """
    try:
        out = subprocess.run(
            ["git", "-C", target, "ls-files", "-z"],
            capture_output=True, check=True, text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return [f for f in out.split("\0") if f]


def ignored_dirs(target):
    """Top-level directory names named in the target's .gitignore, for the no-git fallback."""
    names = set()
    try:
        with open(os.path.join(target, ".gitignore")) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("!") or "*" in line:
                    continue
                if line.endswith("/"):
                    names.add(line.rstrip("/").lstrip("/"))
    except OSError:
        pass
    return names


def source_files(target, exts):
    """Every file in `target` with one of `exts`, relative, sorted, product trees only."""
    tracked = tracked_files(target)
    if tracked is not None:
        return sorted(
            f for f in tracked
            if os.path.splitext(f)[1] in exts and f.split(os.sep)[0] not in SKIP_DIRS
        )

    skip = SKIP_DIRS | ignored_dirs(target)
    found = []
    for dirpath, dirnames, filenames in os.walk(target):
        dirnames[:] = sorted(d for d in dirnames if d not in skip and not d.startswith("."))
        for name in sorted(filenames):
            if os.path.splitext(name)[1] in exts:
                found.append(os.path.relpath(os.path.join(dirpath, name), target))
    return sorted(found)


def clusters(files, n):
    """Split `files` into at most `n` locality clusters, keeping each directory whole.

    Directories are the locality that matters: a worker reading lib/focus/ has the whole
    subsystem in mind, and splitting one directory across two workers would make both of
    them read it. Largest directory first, then packed into the emptiest cluster, so the
    clusters come out roughly even without ever cutting a directory in half.
    """
    by_dir = collections.defaultdict(list)
    for f in files:
        by_dir[os.path.dirname(f) or "."].append(f)
    if not by_dir:
        return []
    n = max(1, min(n, len(by_dir)))
    buckets = [[] for _ in range(n)]
    for directory, group in sorted(by_dir.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        smallest = min(buckets, key=lambda b: sum(len(g) for _, g in b))
        smallest.append((directory, group))
    return [sorted(b) for b in buckets if b]


def describe(cluster):
    """A worker-readable locality: the directories, with the files that are actually in them."""
    parts = []
    for directory, group in cluster:
        if directory == ".":
            parts.append(", ".join(group))
        elif len(group) <= 4:
            parts.append(", ".join(group))
        else:
            parts.append(f"{directory}/ ({len(group)} files)")
    return "; ".join(parts) or "nothing matching in this repo"


# The most rules one worker is asked to hold at once. The point of batching is that a worker
# reads a locality once and answers many rules against it; past this the context stops helping.
MAX_ROWS_PER_BATCH = 60


def split_evenly(rows, n):
    """Deal `rows` into `n` runs of contiguous rows, so a sheet's order survives the split."""
    if n <= 1:
        return [rows]
    size = -(-len(rows) // n)
    return [rows[i:i + size] for i in range(0, len(rows), size)] or [[]]


def fan_out(rows, localities):
    """Pair runs of rows with localities.

    Two things set the number of workers and neither is a property of any one repo: how many
    distinct localities there are to read, and how many rules one worker can usefully hold. A repo
    with its pages in one directory gets one locality and as many runs as the rule count needs; a
    repo with several gets one worker per locality.
    """
    localities = localities or [[]]
    n = max(len(localities), -(-len(rows) // MAX_ROWS_PER_BATCH), 1)
    return [(run, localities[i % len(localities)]) for i, run in enumerate(split_evenly(rows, n))]


def main(argv):
    args = parse_args(argv)
    rules = json.load(open(os.path.join(HERE, "selected_rules.json")))
    by_sheet = collections.defaultdict(list)
    for r in rules:
        by_sheet[r["sheet"]].append(r)

    def take(sheet):
        got = by_sheet[sheet]
        by_sheet[sheet] = []
        return got

    web = source_files(args.target, WEB_EXTS)
    code = source_files(args.target, CODE_EXTS)

    batches = []

    # The interface rules go to whoever holds the pages; the language rules to whoever holds the
    # code. Both localities are what the repo actually contains, not a list typed into this file.
    for prefix, rows, files in (
        ("ux", take("UX"), web),
        ("js", take("Code/JavaScript_TypeScript_Development"), code),
    ):
        runs = fan_out(rows, clusters(files, 2))
        for i, (run, cluster) in enumerate(runs):
            batches.append((f"{prefix}-{chr(ord('a') + i)}", describe(cluster), run))

    # The remaining sheets are not scoped to one locality: they ask about the repo as a whole,
    # about its process, or about artifacts outside the source tree entirely.
    every_source = describe(clusters(web + code, 1)[0]) if (web or code) else "nothing matching in this repo"
    batches.append(("perf-test", f"every source and page file in the repo: {every_source}",
                    take("Code/React_NextJS_Development") + take("Code/Testing_and_Coverage")))
    batches.append(("universal", "the whole repo",
                    take("Code/Universal") + take("Process/Data_Integrity") + take("Project_Structure")))
    batches.append(("copy-design", "user-facing copy and the design surfaces",
                    take("User_Facing_Copy") + take("Design/Visual_Design")
                    + take("Design/Data_Visualization") + take("Design/Design_Fidelity")))
    batches.append(("ops", "deployment, machine safety, secrets",
                    take("Deployment") + take("Machine_Safety") + take("Security_and_Secrets")
                    + take("Assignments") + take("Process/Communication")))
    batches.append(("process", "this session's work product and process",
                    take("Process/Agent_Behavior")))

    leftover = {k: len(v) for k, v in by_sheet.items() if v}
    assert not leftover, f"unrouted rows: {leftover}"

    total = 0
    os.makedirs(os.path.join(HERE, "batches"), exist_ok=True)
    print(f"target: {args.target}  ({len(web)} pages, {len(code)} source files)")
    for name, target, rows in batches:
        total += len(rows)
        json.dump({"batch": name, "target": target, "rules": rows},
                  open(os.path.join(HERE, "batches", f"{name}.json"), "w"), indent=1)
        print(f"{name:12s} {len(rows):4d}  {target}")
    print(f"{'TOTAL':12s} {total:4d}")
    assert total == len(rules), f"{total} routed != {len(rules)} selected"


if __name__ == "__main__":
    main(sys.argv[1:])
