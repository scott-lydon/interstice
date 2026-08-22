#!/usr/bin/env python3
"""Reduce the worker findings and prove the set is exactly the selected set.

Item 7.2 requires the check be done by a script, not by eye: a findings file that is
missing rows, or that carries rows nobody selected, is indistinguishable from a complete
one when you are scrolling it.
"""
import json, os, glob, collections, sys

HERE = os.path.dirname(os.path.abspath(__file__))
selected = json.load(open(os.path.join(HERE, "selected_rules.json")))
want = {r["row_id"]: r for r in selected}

findings, dupes = {}, []
for p in sorted(glob.glob(os.path.join(HERE, "findings", "*.jsonl"))):
    for n, line in enumerate(open(p), 1):
        line = line.strip()
        if not line:
            continue
        try:
            f = json.loads(line)
        except json.JSONDecodeError as e:
            raise SystemExit(f"FATAL: {p}:{n} is not valid JSON: {e}")
        rid = f["row_id"]
        if rid in findings:
            dupes.append(rid)
        findings[rid] = dict(f, _file=os.path.basename(p))

missing = sorted(set(want) - set(findings))
extra = sorted(set(findings) - set(want))

print(f"selected : {len(want)}")
print(f"findings : {len(findings)}")
print(f"missing  : {len(missing)} {missing[:12]}")
print(f"extra    : {len(extra)} {extra[:12]}")
print(f"duplicate: {len(dupes)} {sorted(set(dupes))[:12]}")
print()
print("verdicts :", dict(collections.Counter(f["verdict"] for f in findings.values())))
print()
sev = collections.Counter()
for rid, f in findings.items():
    if f["verdict"] == "FAIL":
        sev[want[rid]["severity"]] += 1
print("FAIL by severity (from the manifest, not the worker):", dict(sev))
print()
open_hi = sorted(rid for rid, f in findings.items()
                 if f["verdict"] == "FAIL" and want[rid]["severity"] in ("blocker", "high"))
print(f"blocker/high FAILs needing 7.3 resolution: {len(open_hi)}")
for rid in open_hi:
    print(f"  {want[rid]['severity']:8s} {rid:38s} {findings[rid]['_file']}")

json.dump({rid: findings[rid] for rid in sorted(findings)},
          open(os.path.join(HERE, "findings_merged.json"), "w"), indent=1)

ok = not missing and not extra and not dupes
print()
print("SET CHECK:", "PASS — findings set is exactly the selected set" if ok else "FAIL")
sys.exit(0 if ok else 1)
