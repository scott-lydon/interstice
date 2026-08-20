#!/usr/bin/env python3
"""Route the selected rules into worker batches, by target locality.

Batching axis is the file cluster a rule targets, not the rule itself: a worker that has
already read web/panel.html can evaluate forty UX rules against it in one pass, whereas
one agent per row would read the same file 346 times.
"""
import json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
rules = json.load(open(os.path.join(HERE, "selected_rules.json")))
by_sheet = collections.defaultdict(list)
for r in rules:
    by_sheet[r["sheet"]].append(r)

def take(sheet, n=None):
    got = by_sheet[sheet]
    if n is None:
        by_sheet[sheet] = []
        return got
    head, by_sheet[sheet] = got[:n], got[n:]
    return head

BATCHES = []
ux = by_sheet["UX"]
BATCHES.append(("ux-a", "web/panel.html (the product's whole interface)", ux[:48]))
BATCHES.append(("ux-b", "web/panel.html, web/dashboard.html, web/learn.html", ux[48:]))
by_sheet["UX"] = []

js = by_sheet["Code/JavaScript_TypeScript_Development"]
BATCHES.append(("js-a", "lib/focus/**, lib/video/**, lib/latency.js, lib/reader.js", js[:58]))
BATCHES.append(("js-b", "lib/server.js, lib/daemon.js, lib/panel.js, lib/router.js, bin/, hooks/", js[58:]))
by_sheet["Code/JavaScript_TypeScript_Development"] = []

BATCHES.append(("perf-test", "every .js and .html file in the repo, plus test/",
                take("Code/React_NextJS_Development") + take("Code/Testing_and_Coverage")))
BATCHES.append(("universal", "the whole repo",
                take("Code/Universal") + take("Process/Data_Integrity") + take("Project_Structure")))
BATCHES.append(("copy-design", "user-facing copy and the design surfaces",
                take("User_Facing_Copy") + take("Design/Visual_Design")
                + take("Design/Data_Visualization") + take("Design/Design_Fidelity")))
BATCHES.append(("ops", "deployment, machine safety, secrets",
                take("Deployment") + take("Machine_Safety") + take("Security_and_Secrets")
                + take("Assignments") + take("Process/Communication")))
BATCHES.append(("process", "this session's work product and process",
                take("Process/Agent_Behavior")))

leftover = {k: len(v) for k, v in by_sheet.items() if v}
assert not leftover, f"unrouted rows: {leftover}"

total = 0
os.makedirs(os.path.join(HERE, "batches"), exist_ok=True)
for name, target, rows in BATCHES:
    total += len(rows)
    json.dump({"batch": name, "target": target, "rules": rows},
              open(os.path.join(HERE, "batches", f"{name}.json"), "w"), indent=1)
    print(f"{name:12s} {len(rows):4d}  {target}")
print(f"{'TOTAL':12s} {total:4d}")
assert total == len(rules), f"{total} routed != {len(rules)} selected"
