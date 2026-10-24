"""Hit my target: the least-risky set of recommendations that cuts the bill by a chosen percent.

Each VM offers a small menu (do nothing, resize, schedule, or resize + schedule) and the plan picks at most one
option per VM. The plan is EXACT, not greedy: a multiple-choice knapsack over savings in ₹100 steps, ranked by
  1. fewest HIGH-risk changes, 2. fewest MEDIUM-risk changes, 3. lowest total risk score,
  4. fewest changes, 5. least overshoot.
The required upsizes are always in the plan and their extra cost is netted from the saving, so the planner,
the Overview and the Before/After page agree. Mirrored in lib/engine.ts (planForTarget).
"""
from __future__ import annotations

STEP_INR = 100
LEVELS = ["LOW", "MEDIUM", "HIGH"]
RANK = {lv: i for i, lv in enumerate(LEVELS)}
ELIGIBLE = {"resize", "schedule", "stop", "delete_volume", "release_ip"}   # keep / review / investigate are never picked
PHASE = {"delete_volume": 1, "release_ip": 1, "stop": 1}                    # week 1: clean-ups with nothing running


def options(recs: list[dict], max_risk: str = "HIGH", excluded: set[str] = frozenset()) -> list[list[dict]]:
    """Per resource, the ways to act on it. An option = {recs, saving, risk, score}."""
    by_res: dict[str, list[dict]] = {}
    for r in recs:
        if r["action"] in ELIGIBLE and r["saving"] > 0 and r["id"] not in excluded and RANK[r["risk"]] <= RANK[max_risk]:
            by_res.setdefault(r["resource_id"], []).append(r)
    groups = []
    for rid in sorted(by_res):
        rs = by_res[rid]
        resize = next((r for r in rs if r["action"] == "resize"), None)
        sched = next((r for r in rs if r["action"] == "schedule"), None)
        opts = []
        for r in rs:
            # a schedule without its resize runs on the bigger current size, so it saves more
            saving = r.get("saving_alone", r["saving"]) if r["action"] == "schedule" else r["saving"]
            opts.append({"recs": [r], "saving": saving, "risk": r["risk"], "score": r["risk_score"]})
        if resize and sched:
            both = [resize, sched]
            opts.append({"recs": both, "saving": resize["saving"] + sched["saving"],
                         "risk": max((x["risk"] for x in both), key=RANK.get), "score": resize["risk_score"] + sched["risk_score"]})
        groups.append(opts)
    return groups


def required(recs: list[dict]) -> list[dict]:
    """Upsizes fix VMs that are already too small: always in the plan, they add cost."""
    return [r for r in recs if r["action"] == "upsize" and r["default_accepted"]]


def _key(o: dict) -> tuple:
    hi = 1 if o["risk"] == "HIGH" else 0
    med = 1 if o["risk"] == "MEDIUM" else 0
    return hi, med, round(o["score"] * 1000), len(o["recs"])


def tiers(recs: list[dict], bill: float) -> list[dict]:
    """The most each risk level can save (best option per VM), net of the required upsizes."""
    extra = -sum(r["saving"] for r in required(recs))
    out = []
    for lv in LEVELS:
        gross = sum(max(o["saving"] for o in g) for g in options(recs, lv))
        out.append({"risk": lv, "saving": gross - extra, "pct": round((gross - extra) / bill * 100, 2)})
    return out


def plan_for_target(recs: list[dict], bill: float, pct: float, excluded: set[str] = frozenset()) -> dict:
    target = bill * pct / 100
    must = required(recs)
    extra = -sum(r["saving"] for r in must)        # upsizes have negative saving
    need = target + extra                           # gross saving the optional changes must reach
    groups = options(recs, "HIGH", excluded)
    cap = sum(max(o["saving"] for o in g) for g in groups) // STEP_INR + 1

    # best[s] = (key, saving) of the cheapest way to reach s units of saving with the groups seen so far
    best: list = [None] * (cap + 1)
    best[0] = ((0, 0, 0, 0), 0)
    choice = []
    for g in groups:
        nxt = list(best)
        pick = [-1] * (cap + 1)
        for s, cur in enumerate(best):
            if cur is None:
                continue
            for i, o in enumerate(g):
                s2 = min(cap, s + o["saving"] // STEP_INR)
                k = tuple(a + b for a, b in zip(cur[0], _key(o)))
                cand = (k, cur[1] + o["saving"])
                if nxt[s2] is None or cand < nxt[s2]:
                    nxt[s2] = cand
                    pick[s2] = (s, i)
        choice.append(pick)
        best = nxt

    # states are counted in whole ₹100 steps (rounded down), so "reached" is checked on the real rupee total
    reached_states = [s for s in range(cap + 1) if best[s] is not None and best[s][1] >= need]
    reached = bool(reached_states)
    if reached:   # least risk first, then least overshoot
        end = min(reached_states, key=lambda s: (best[s][0], best[s][1]))
    else:         # cannot get there: show the most the safety rules allow
        end = max((s for s in range(cap + 1) if best[s] is not None), key=lambda s: (best[s][1], [-x for x in best[s][0]]))
    chosen = []
    s = end
    for gi in range(len(groups) - 1, -1, -1):
        p = choice[gi][s]
        if p != -1:          # -1: this VM was left alone
            s, i = p
            chosen.append(groups[gi][i])
    chosen.reverse()
    return summarise(recs, bill, pct, target, chosen, must, reached, groups)


def summarise(recs, bill, pct, target, chosen, must, reached, groups) -> dict:
    items = []
    for o in chosen:
        for r in o["recs"]:
            saving = o["saving"] if len(o["recs"]) == 1 else r["saving"]
            items.append({"id": r["id"], "resource_id": r["resource_id"], "action": r["action"], "risk": r["risk"],
                          "risk_score": r["risk_score"], "saving": saving, "env": r["env"],
                          "phase": PHASE.get(r["action"], 3 if r["env"] == "prod" else 2)})
    for r in must:
        items.append({"id": r["id"], "resource_id": r["resource_id"], "action": r["action"], "risk": r["risk"],
                      "risk_score": r["risk_score"], "saving": r["saving"], "env": r["env"], "phase": 1})
    net = sum(i["saving"] for i in items)
    gross = sum(i["saving"] for i in items if i["saving"] > 0)
    plan_risk = sum(i["risk_score"] * i["saving"] for i in items if i["saving"] > 0) / gross if gross else 0.0
    tr = tiers(recs, bill)
    used = {lv: sum(1 for i in items if i["risk"] == lv and i["saving"] > 0) for lv in LEVELS}
    if not reached:
        msg = (f"A {pct:g}% cut (₹{target:,.0f}) cannot be reached safely. Every safe change together saves "
               f"₹{net:,.0f} ({net / bill:.1%}); VMs whose peaks would not fit a smaller size are never touched.")
    elif used["HIGH"]:
        msg = f"Reached only with {used['HIGH']} high-risk change(s): low + medium changes top out at {tr[1]['pct']:.1f}%."
    elif used["MEDIUM"]:
        msg = (f"Low-risk changes alone top out at {tr[0]['pct']:.1f}% of the bill, so the plan adds "
               f"{used['MEDIUM']} medium-risk change(s) to reach {pct:g}%.")
    else:
        msg = f"Reached with low-risk changes only ({used['LOW']} changes)."
    return {"pct": pct, "target": round(target), "reached": reached, "saving": net, "achieved_pct": round(net / bill * 100, 2),
            "upsize_cost": -sum(r["saving"] for r in must), "plan_risk": round(plan_risk, 3), "counts": used,
            "items": sorted(items, key=lambda i: (i["phase"], RANK[i["risk"]], -i["saving"], i["id"])),
            "tiers": tr, "message": msg}
