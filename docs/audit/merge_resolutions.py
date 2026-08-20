#!/usr/bin/env python3
"""Fold the per-cluster resolution files into the findings, and prove the closing bar is met.

The bar is that no blocker or high finding is left in an open state: each is either fixed with
a commit reference or refuted with a reason specific to this repo. Checked by script, because a
campaign this size is exactly where an eye slides past the one row nobody did.

Run with `--conditionals` to rewrite docs/audit/CONDITIONAL_RESOLUTIONS.md instead. That mode
reads and writes nothing else, so it can be re-run without disturbing the findings.
"""
import glob, json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
sel = {r["row_id"]: r for r in json.load(open(os.path.join(HERE, "selected_rules.json")))}
findings = json.load(open(os.path.join(HERE, "findings_merged.json")))


HEADER = """# Conditional rules, and how each one resolved

Verdicts as the workers measured them on 2026-08-19 and into 2026-08-20, against the tree at
commit 7aa8ea1 and recorded in commit a72e5f6. They are a snapshot of that tree and are not
re-checked as it moves, so read every present-tense sentence below as "was true then". At least
one has already been overtaken: DEP-003 was fixed after the audit, and `lib/install.js` now
returns the real load result from `reloadLaunchAgent` while `bin/interstice.js` exits non-zero
when the LaunchAgent did not end up running, so the unconditional "loaded" line the row describes
no longer exists. Regenerate this file with `python3 docs/audit/merge_resolutions.py --conditionals`.
"""


def emit_conditionals():
    """Rewrite CONDITIONAL_RESOLUTIONS.md from the manifest and the findings.

    The precondition column is printed whole. An earlier version sliced it to 70 characters,
    which cut every row mid-word and hid the one thing the table exists to show: the condition
    the verdict turned on. A column that cannot hold its content is a column that lies quietly,
    so it wraps in the reader's viewer instead of being cut here.
    """
    rows = sorted((rid, r) for rid, r in sel.items() if r.get("verdict") == "conditional")
    out = [HEADER, f"Conditional rows: {len(rows)}. Each names its precondition and whether it held.", ""]
    out.append("| row_id | sheet | precondition (from the manifest) | held? | applies? | verdict |")
    out.append("|---|---|---|---|---|---|")
    for rid, r in rows:
        f = findings.get(rid)
        if f is None:
            raise SystemExit(f"FATAL: conditional row {rid} has no finding; the table would omit it silently.")
        held = "no" if f["verdict"] == "NA" else "yes"
        pre = (r.get("reason") or "").strip().replace("|", "\\|")
        out.append(f"| `{rid}` | {r['sheet']} | {pre} | {held} | {held} | {f['verdict']} |")
    out += ["", "### Evidence per conditional row", ""]
    for rid, _ in rows:
        f = findings[rid]
        out.append(f"- **`{rid}`** ({f['verdict']}): {(f.get('evidence') or '').strip()}")
    out.append("")
    path = os.path.join(HERE, "CONDITIONAL_RESOLUTIONS.md")
    open(path, "w").write("\n".join(out))
    print(f"wrote {path} ({len(rows)} conditional rows, preconditions printed whole)")


if "--conditionals" in sys.argv:
    emit_conditionals()
    sys.exit(0)

merged = 0
for p in sorted(glob.glob(os.path.join(HERE, "resolutions", "*.json"))):
    for rid, res in json.load(open(p)).items():
        if rid not in findings:
            raise SystemExit(f"FATAL: {os.path.basename(p)} resolves {rid}, which is not a finding.")
        res["source"] = os.path.basename(p)
        findings[rid]["resolution"] = res
        merged += 1
json.dump(findings, open(os.path.join(HERE, "findings_merged.json"), "w"), indent=1)

need = [rid for rid, f in findings.items()
        if f["verdict"] == "FAIL" and sel[rid]["severity"] in ("blocker", "high")]
open_rows, bad = [], []
for rid in need:
    r = findings[rid].get("resolution")
    if not r:
        open_rows.append(rid); continue
    if r.get("state") not in ("fixed", "refuted"):
        bad.append(f"{rid}: state={r.get('state')!r}")
    elif not (r.get("how") or "").strip():
        bad.append(f"{rid}: no reason recorded")
    elif r["state"] == "fixed" and not (r.get("verified") or "").strip():
        bad.append(f"{rid}: fixed with no verification recorded")

print(f"resolutions merged      : {merged}")
print(f"blocker/high FAIL rows  : {len(need)}")
print(f"  fixed                 : {sum(1 for r in need if findings[r].get('resolution', {}).get('state') == 'fixed')}")
print(f"  refuted               : {sum(1 for r in need if findings[r].get('resolution', {}).get('state') == 'refuted')}")
print(f"  still open            : {len(open_rows)} {open_rows}")
print(f"  malformed             : {len(bad)} {bad}")
by = collections.Counter(sel[r]["severity"] for r in need)
print(f"by severity             : {dict(by)}")
ok = not open_rows and not bad
print("\n7.3 CHECK:", "PASS, every blocker and high finding is fixed or refuted with a recorded reason"
      if ok else "FAIL")
sys.exit(0 if ok else 1)
