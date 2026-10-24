"""Hit my target planner (engine/target.py)."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from target import plan_for_target, tiers  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "public" / "data"


def rec(i, res, action, saving, risk="LOW", score=0.1, **kw):
    return {"id": f"rec-{i}", "resource_id": res, "action": action, "saving": saving, "risk": risk,
            "risk_score": score, "env": "dev", "default_accepted": action not in ("keep", "review", "investigate"), **kw}


def test_resize_and_schedule_on_one_vm_stack():
    """The teammate draft allowed one action per VM; ours stack (schedule priced after the resize)."""
    recs = [rec(1, "vm-a", "resize", 3000), rec(2, "vm-a", "schedule", 3214, saving_alone=5143)]
    plan = plan_for_target(recs, 100_000, 6.2)
    assert {i["action"] for i in plan["items"]} == {"resize", "schedule"}
    assert plan["saving"] == 6214


def test_schedule_alone_uses_the_bigger_saving():
    recs = [rec(1, "vm-a", "resize", 3000, "MEDIUM", 0.4), rec(2, "vm-a", "schedule", 3214, saving_alone=5143)]
    plan = plan_for_target(recs, 100_000, 5)
    assert [i["action"] for i in plan["items"]] == ["schedule"] and plan["saving"] == 5143


def test_low_risk_is_used_before_medium_even_if_more_changes():
    recs = [rec(1, "vm-a", "resize", 5000, "MEDIUM", 0.4), rec(2, "vm-b", "stop", 2500), rec(3, "vm-c", "stop", 2600)]
    plan = plan_for_target(recs, 100_000, 5)
    assert plan["counts"] == {"LOW": 2, "MEDIUM": 0, "HIGH": 0}


def test_exact_beats_greedy_and_controls_overshoot():
    # biggest-first greedy takes 9000 + 1000 for an 8% target; the exact plan finds the single 8100 change
    recs = [rec(1, "vm-a", "stop", 9000, "MEDIUM", 0.4), rec(2, "vm-b", "stop", 8100, "MEDIUM", 0.4),
            rec(3, "vm-c", "stop", 1000)]
    plan = plan_for_target(recs, 100_000, 8)
    assert [i["id"] for i in plan["items"]] == ["rec-2"] and plan["saving"] == 8100


def test_never_picks_keep_review_or_investigate():
    recs = [rec(1, "vm-a", "review", 4000, "HIGH", 0.9), rec(2, "vm-b", "keep", 0), rec(3, "vm-c", "stop", 1000)]
    plan = plan_for_target(recs, 100_000, 3)
    assert not plan["reached"] and [i["action"] for i in plan["items"]] == ["stop"]
    assert "cannot be reached" in plan["message"]


def test_upsizes_are_always_in_and_netted():
    recs = [rec(1, "vm-a", "upsize", -3000), rec(2, "vm-b", "stop", 5000)]
    plan = plan_for_target(recs, 100_000, 2)
    assert plan["saving"] == 2000 and plan["upsize_cost"] == 3000
    assert {i["action"] for i in plan["items"]} == {"upsize", "stop"}


def test_excluded_cards_are_replanned_around():
    recs = [rec(1, "vm-a", "stop", 5000), rec(2, "vm-b", "stop", 5000)]
    plan = plan_for_target(recs, 100_000, 5, excluded={"rec-1"})
    assert [i["id"] for i in plan["items"]] == ["rec-2"]


@pytest.mark.skipif(not (DATA / "summary.json").exists(), reason="run engine/build.py first")
def test_live_data_tiers_and_plans_are_consistent():
    recs = json.loads((DATA / "recommendations.json").read_text())
    s = json.loads((DATA / "summary.json").read_text())
    bill = s["current_monthly"]
    tr = tiers(recs, bill)
    assert s["target_tiers"] == tr
    assert tr[0]["pct"] < tr[1]["pct"] < tr[2]["pct"]
    # every safe change together = the Overview's potential saving minus the upsizes' extra cost
    upsize = -sum(r["saving"] for r in recs if r["action"] == "upsize")
    assert tr[2]["saving"] == s["potential_saving"] - upsize
    for pct in (5, 10, tr[0]["pct"] - 0.5, 15, 20):
        p = plan_for_target(recs, bill, pct)
        assert p["reached"] and p["saving"] >= bill * pct / 100
        assert len({(i["resource_id"], i["action"]) for i in p["items"]}) == len(p["items"])
        if p["counts"]["MEDIUM"]:       # medium only when low alone cannot get there
            assert tr[0]["pct"] < pct
        assert p["counts"]["HIGH"] == 0
    assert not plan_for_target(recs, bill, tr[2]["pct"] + 1)["reached"]
    # the gap to next month's budget is closed with low-risk changes only
    gap = s["projected_next_month"] - s["budget_monthly"]
    p = plan_for_target(recs, bill, gap / bill * 100)
    assert p["reached"] and p["counts"]["MEDIUM"] == 0 and p["counts"]["HIGH"] == 0
