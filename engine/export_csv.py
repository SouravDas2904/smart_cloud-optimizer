"""Exports every number the dashboard uses as plain CSV files.

    python engine/export_csv.py <out_dir>

Reads the raw simulated metrics (engine/data/) and the computed results (public/data/).
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import config as C
from generate import DATA_DIR, METRICS

PUB = Path(__file__).resolve().parent.parent / "public" / "data"
STAT_COLS = ["cpu_avg", "cpu_p50", "cpu_p95", "cpu_p99", "cpu_max", "mem_avg", "mem_p95", "mem_p99", "mem_max",
             "cpu_time_above_80", "offhours_cpu_avg", "work_cpu_avg", "net_p95_mbps", "iops_p95", "disk_now",
             "disk_slope_per_day", "egress_gb_30d", "cv", "days_of_data", "missing_frac"]
UNITS = {"cpu": "cpu_pct", "mem": "mem_pct", "disk": "disk_pct", "iops": "iops", "net_in": "net_in_mbps", "net_out": "net_out_mbps"}


def load(name):
    return json.loads((PUB / f"{name}.json").read_text())


def write(path: Path, header: list[str], rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        n = 0
        for r in rows:
            w.writerow(r)
            n += 1
    print(f"{path.name}: {n:,} rows")


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    resources, recs, alerts = load("resources"), load("recommendations"), load("alerts")
    forecast, summary, fleet = load("forecast"), load("summary"), load("fleet")
    names = {r["id"]: r["name"] for r in resources}

    base = ["id", "name", "type", "region", "env", "team", "created_at", "plan", "vcpu", "ram_gb", "disk_gb", "attached_to", "detached_since"]
    write(out / "01_resources.csv",
          base + ["cost_compute_inr", "cost_storage_inr", "cost_network_inr", "cost_ip_inr", "cost_total_inr_month"] + STAT_COLS,
          ([r.get(k) for k in base] + [r["cost"][k] for k in ("compute", "storage", "network", "ip", "total")]
           + [(r["stats"] or {}).get(k) for k in STAT_COLS] for r in resources))

    # raw 5-minute metrics, one row per VM per reading
    z = np.load(DATA_DIR / "metrics.npz")
    ids = list(z["ids"])
    ts = pd.date_range(C.START, periods=C.N_POINTS, freq=f"{C.STEP_MIN}min").strftime("%Y-%m-%d %H:%M")

    def raw_rows():
        for i, vid in enumerate(ids):
            cols = [z[m][i] for m in METRICS]
            for t in range(C.N_POINTS):
                if np.isnan(cols[0][t]):
                    continue   # VM not created yet, or an agent outage
                yield [ts[t], vid, names[vid]] + [round(float(c[t]), 3) for c in cols]
    write(out / "02_metrics_5min.csv", ["timestamp_ist", "vm_id", "vm_name"] + [UNITS[m] for m in METRICS], raw_rows())

    # the 30-minute series the charts draw
    def chart_rows():
        for vid in ids:
            s = json.loads((PUB / "series" / f"{vid}.json").read_text())
            t30 = pd.date_range(s["start"], periods=len(s["cpu"]), freq="30min").strftime("%Y-%m-%d %H:%M")
            for t in range(len(s["cpu"])):
                if s["cpu"][t] is None:
                    continue
                yield [t30[t], vid, names[vid], s["cpu"][t], s["cpu_max"][t], s["mem"][t], s["disk"][t], s["iops"][t], s["net_in"][t], s["net_out"][t]]
    write(out / "03_metrics_30min_charts.csv",
          ["timestamp_ist", "vm_id", "vm_name", "cpu_pct_avg", "cpu_pct_max", "mem_pct", "disk_pct", "iops", "net_in_mbps", "net_out_mbps"], chart_rows())

    write(out / "04_recommendations.csv",
          ["id", "resource_id", "resource_name", "resource_type", "env", "region", "team", "action", "title", "current_plan", "target_plan",
           "saving_inr_month", "risk", "confidence", "default_accepted", "vcpu_removed", "cpu_p99_before", "cpu_p99_after", "mem_p99_after",
           "co2_kg_month", "reason", "maths", "confidence_notes"],
          ([r["id"], r["resource_id"], r["resource_name"], r["resource_type"], r["env"], r["region"], r["team"], r["action"], r["title"],
            r.get("current_plan"), r.get("target_plan"), r["saving"], r["risk"], r["confidence"], r["default_accepted"],
            round(r.get("vcpu_removed") or 0, 2), (r.get("peak_check") or {}).get("cpu_p99_before"), (r.get("peak_check") or {}).get("cpu_p99_after"),
            (r.get("peak_check") or {}).get("mem_p99_after"), r["carbon"]["kg_co2"], r["reason"], " | ".join(r["maths"]),
            " | ".join(r["confidence_notes"])] for r in recs))

    write(out / "05_alerts.csv",
          ["id", "kind", "severity", "title", "resource_id", "resource_name", "team", "env", "region", "metric", "start", "end", "date",
           "days_left", "cost_impact_inr", "why"],
          ([a["id"], a["kind"], a["severity"], a["title"], a.get("resource_id"), a.get("resource_name"), a.get("team"), a.get("env"),
            a.get("region"), a.get("metric"), a.get("start"), a.get("end"), a.get("date"), a.get("days_left"), a["cost_impact"], a["why"]] for a in alerts))

    write(out / "06_daily_costs.csv", ["date", "cost_inr"], ([d["date"], d["inr"]] for d in forecast["history"]))
    write(out / "07_forecast_90d.csv", ["date", "forecast_inr", "low_inr", "high_inr"],
          ([d["date"], d["inr"], d["lo"], d["hi"]] for d in forecast["forecast"]))
    write(out / "08_bill_history.csv", ["month", "bill_inr"], ([b["month"], b["inr"]] for b in summary["bill_history"]))

    t = fleet["timeline"]
    hours = pd.date_range(t["start"], periods=len(t["cpu_pct"]), freq="60min").strftime("%Y-%m-%d %H:%M")
    write(out / "09_fleet_hourly.csv",
          ["timestamp_ist", "cpu_used_pct", "mem_used_pct", "disk_used_pct", "vcpu_used", "vcpu_provisioned", "net_in_mbps", "net_out_mbps", "iops"],
          ([hours[i], t["cpu_pct"][i], t["mem_pct"][i], t["disk_pct"][i], t["vcpu_used"][i], t["vcpu_prov"][i], t["net_in_mbps"][i],
            t["net_out_mbps"][i], t["iops"][i]] for i in range(len(hours))))

    write(out / "10_plans_price_list.csv", ["plan", "vcpu", "ram_gb", "inr_per_month", "inr_per_hour"],
          ([p, v, m, price, round(price / C.HOURS_PER_MONTH, 2)] for p, (v, m, price) in C.PLANS.items()))
    write(out / "11_assumptions.csv", ["name", "value"],
          ([k, getattr(C, k)] for k in sorted(dir(C)) if k.isupper() and k not in ("PLANS", "PLAN_ORDER")))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "export"))
