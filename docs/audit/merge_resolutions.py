#!/usr/bin/env python3
"""Fold the per-cluster resolution files into the findings, and prove 7.3's bar is met.

Item 7.3 asks that no blocker or high finding is left in an open state: each is either fixed with
a commit reference or refuted with a reason specific to this repo. Checked by script, because a
campaign this size is exactly where an eye slides past the one row nobody did.
"""
import glob, json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
sel = {r["row_id"]: r for r in json.load(open(os.path.join(HERE, "selected_rules.json")))}
findings = json.load(open(os.path.join(HERE, "findings_merged.json")))

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
