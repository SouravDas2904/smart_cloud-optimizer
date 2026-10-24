"""Invariants on the generated dashboard data (run after engine/build.py)."""
import collections
import json
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[2] / "public" / "data"
pytestmark = pytest.mark.skipif(not (DATA / "summary.json").exists(), reason="run engine/build.py first")


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


def test_costs_add_up():
    res, s = load("resources"), load("summary")
    for r in res:
        c = r["cost"]
        assert c["total"] == c["compute"] + c["storage"] + c["network"] + c["ip"]
    assert abs(sum(r["cost"]["total"] for r in res) - s["current_monthly"]) <= 1


def test_every_resize_respects_headroom():
    for r in load("recommendations"):
        if r["action"] == "resize":
            assert r["peak_check"]["cpu_p99_after"] <= 70.01
            assert r["peak_check"]["mem_p99_after"] <= 75.01
            assert r["peak_check"]["cpu_max_after"] <= 95.01   # no single 5-min reading over the ceiling


def test_bill_history_is_computed_from_inventory():
    s = load("summary")
    bills = [b["inr"] for b in s["bill_history"]]
    assert len(bills) == 7 and bills == sorted(bills)   # resources are only ever added in the simulation
    assert bills[-1] <= s["current_monthly"]            # the last month is at most today's full run-rate


def test_production_is_never_stopped_or_scheduled():
    assert not any(r["env"] == "prod" and r["action"] in ("stop", "schedule") for r in load("recommendations"))


def test_only_compatible_actions_are_combined():
    by = collections.defaultdict(list)
    for r in load("recommendations"):
        by[r["resource_id"]].append(r["action"])
    for actions in by.values():
        if len(actions) > 1:
            assert sorted(actions) in (["resize", "schedule"], ["keep", "schedule"])


def test_showcase_vms():
    recs = load("recommendations")
    names = {r["resource_name"]: r for r in recs}
    assert names["prod-reports-01"]["action"] == "keep"
    assert names["prod-pay-api-07"]["action"] == "investigate"
    assert any(a["kind"] == "anomaly" and a["resource_name"] == "prod-pay-api-07" for a in load("alerts"))
