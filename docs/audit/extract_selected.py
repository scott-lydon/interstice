#!/usr/bin/env python3
"""Emit the selected rule set as JSON, from the same table that generates the manifest.

Reusing recurring_goals_selection's DECISIONS and ROW_OVERRIDES is the point: an
extractor with its own copy of the table could disagree with the manifest and nobody
would notice. Import it, do not re-implement it.
"""
import importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "rgs", os.path.join(HERE, "..", "recurring_goals_selection.py"))
rgs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rgs)

rows = rgs.load_rows(rgs.ROOT)
out = []
for r, verdict, reason in rgs.classify(rows):
    if verdict not in ("include", "conditional"):
        continue
    out.append({
        "row_id": r["row_id"],
        "sheet": r["_sheet"],
        "title": r.get("rule_title", ""),
        "severity": r.get("severity", ""),
        "applies_to": r.get("applies_to", ""),
        "verdict": verdict,
        "reason": reason,
        "prompt": r.get("agent_prompt", ""),
    })
json.dump(out, sys.stdout, indent=1)
