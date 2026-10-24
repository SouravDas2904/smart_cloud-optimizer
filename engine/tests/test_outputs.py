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


def test_memory_leak_is_caught_as_a_capacity_trend():
    leak = [a for a in load("alerts") if a["id"].startswith("memtrend-")]
    assert len(leak) == 1 and 0 < leak[0]["days_left"] < 21


def test_usage_forecast_covers_90_days_within_0_to_100():
    u = load("forecast")["usage"]
    for k in ("cpu", "mem"):
        assert len(u[k]["forecast"]) == 90
        assert all(0 <= d["lo"] <= d["pct"] <= d["hi"] <= 100 for d in u[k]["forecast"])


def test_filter_cells_add_up_to_the_fleet():
    cells, fleet = load("fleet_cells")["cells"], load("fleet")["timeline"]
    for i in (0, 300, 700):
        used = sum(c["vcpu_used"][i] for c in cells)
        prov = sum(c["vcpu_prov"][i] for c in cells)
        assert abs(used / prov * 100 - fleet["cpu_pct"][i]) < 0.2
