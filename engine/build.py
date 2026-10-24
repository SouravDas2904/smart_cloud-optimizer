"""Runs the whole pipeline and writes the JSON the dashboard reads (public/data/).

    python engine/generate.py   # simulated estate -> engine/data/
    python engine/build.py      # stats, recommendations, alerts, forecast -> public/data/
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import config as C
from alerts import build_alerts, robust_anomaly
from forecast import backtest, holt_winters
from generate import DATA_DIR, METRICS, START, bill_history
from recommend import monthly_cost, recommend_orphan, recommend_vm
from stats import vm_stats

OUT = Path(__file__).resolve().parent.parent / "public" / "data"
DAYS_PER_MONTH = C.HOURS_PER_MONTH / 24
NOW = (START + pd.Timedelta(days=C.DAYS)).isoformat()


def load():
    inv = json.loads((DATA_DIR / "inventory.json").read_text())
    z = np.load(DATA_DIR / "metrics.npz")
    ids = list(z["ids"])
    series = {vid: {m: z[m][i].astype(float) for m in METRICS} for i, vid in enumerate(ids)}
    return inv, series


def downsample(s: dict, bucket=6) -> dict:
    """30-minute buckets for charts: averages, plus the max so short CPU peaks stay visible."""
    def agg(x, fn):
        v = x.reshape(-1, bucket)
        with np.errstate(all="ignore"):
            out = fn(v, axis=1)
        return [None if np.isnan(a) else round(float(a), 2) for a in out]
    return {"cpu": agg(s["cpu"], np.nanmean), "cpu_max": agg(s["cpu"], np.nanmax), "mem": agg(s["mem"], np.nanmean),
            "disk": agg(s["disk"], np.nanmean), "iops": agg(s["iops"], np.nanmean),
            "net_in": agg(s["net_in"], np.nanmean), "net_out": agg(s["net_out"], np.nanmean)}


def daily_costs(inv, series):
    days = []
    for d in range(C.DAYS):
        date = (START + pd.Timedelta(days=d)).date().isoformat()
        sl = slice(d * C.POINTS_PER_DAY, (d + 1) * C.POINTS_PER_DAY)
        total = 0.0
        for r in inv:
            if r["created_at"][:10] > date:
                continue
            if r["type"] == "vm":
                s = series[r["id"]]
                if np.isnan(s["cpu"][sl]).all() and r["created_at"][:10] >= date:
                    continue
                total += C.PLANS[r["plan"]][2] / DAYS_PER_MONTH
                total += r["disk_gb"] * C.BLOCK_INR_PER_GB_MONTH / DAYS_PER_MONTH
                total += np.nansum(s["net_out"][sl]) * C.STEP_MIN * 60 / 1024 * C.EGRESS_INR_PER_GB
            elif r["type"] == "volume":
                total += r["disk_gb"] * C.BLOCK_INR_PER_GB_MONTH / DAYS_PER_MONTH
            else:
                total += C.PUBLIC_IP_INR_PER_MONTH / DAYS_PER_MONTH
        days.append({"date": date, "inr": round(total)})
    return days


def fleet_rollup(vms, series, stats):
    """Fleet-wide utilisation per hour: how much of the provisioned CPU, RAM and disk is actually used."""
    hours = C.N_POINTS // 12
    vcpu = np.array([r["vcpu"] for r in vms], dtype=float)[:, None]
    ram = np.array([r["ram_gb"] for r in vms], dtype=float)[:, None]
    disk_gb = np.array([r["disk_gb"] for r in vms], dtype=float)[:, None]

    def hourly(m):   # VMs x hours, NaN where the VM did not exist yet
        x = np.stack([series[r["id"]][m] for r in vms]).reshape(len(vms), hours, 12)
        with np.errstate(all="ignore"):
            return np.nanmean(x, axis=2)

    cpu, mem, disk = hourly("cpu"), hourly("mem"), hourly("disk")
    alive = ~np.isnan(cpu)
    used_vcpu = np.nansum(cpu / 100 * vcpu, axis=0)
    used_ram = np.nansum(mem / 100 * ram, axis=0)
    used_disk = np.nansum(disk / 100 * disk_gb, axis=0)
    prov_vcpu, prov_ram, prov_disk = (alive * vcpu).sum(0), (alive * ram).sum(0), (alive * disk_gb).sum(0)
    net_in, net_out, iops = (np.nansum(hourly(m), axis=0) for m in ("net_in", "net_out", "iops"))
    rnd = lambda a, d=1: [round(float(v), d) for v in a]
    timeline = {
        "start": C.START, "step_min": 60,
        "cpu_pct": rnd(used_vcpu / prov_vcpu * 100), "mem_pct": rnd(used_ram / prov_ram * 100),
        "disk_pct": rnd(used_disk / prov_disk * 100),
        "vcpu_used": rnd(used_vcpu), "vcpu_prov": rnd(prov_vcpu, 0),
        "net_in_mbps": rnd(net_in, 2), "net_out_mbps": rnd(net_out, 2), "iops": rnd(iops, 0),
    }

    def groups(key):
        out = {}
        for r in vms:
            st, g = stats[r["id"]], out.setdefault(r[key], {"vms": 0, "vcpu": 0, "ram_gb": 0, "disk_gb": 0, "_cpu": 0.0, "_mem": 0.0, "_disk": 0.0, "egress_gb": 0.0})
            g["vms"] += 1; g["vcpu"] += r["vcpu"]; g["ram_gb"] += r["ram_gb"]; g["disk_gb"] += r["disk_gb"]
            g["_cpu"] += st["cpu_avg"] / 100 * r["vcpu"]; g["_mem"] += st["mem_avg"] / 100 * r["ram_gb"]
            g["_disk"] += st["disk_now"] / 100 * r["disk_gb"]; g["egress_gb"] += st["egress_gb_30d"]
        for g in out.values():   # capacity-weighted utilisation (a 16-vCPU VM counts more than a 2-vCPU one)
            g["cpu_pct"] = round(g.pop("_cpu") / g["vcpu"] * 100, 1)
            g["mem_pct"] = round(g.pop("_mem") / g["ram_gb"] * 100, 1)
            g["disk_pct"] = round(g.pop("_disk") / g["disk_gb"] * 100, 1)
            g["egress_gb"] = round(g["egress_gb"])
        return dict(sorted(out.items()))

    return {"timeline": timeline, "by_region": groups("region"), "by_team": groups("team"), "by_env": groups("env")}


def carbon_kg(vcpu: float) -> dict:
    kwh = vcpu * C.WATTS_PER_VCPU * C.HOURS_PER_MONTH * C.PUE / 1000
    return {"kwh": round(kwh, 1), "kg_co2": round(kwh * C.GRID_KG_CO2_PER_KWH, 1)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "series").mkdir(exist_ok=True)
    inv, series = load()
    vms = [r for r in inv if r["type"] == "vm"]
    stats = {r["id"]: vm_stats(series[r["id"]]) for r in vms}

    # monthly cost per resource (egress normalised from the VM's lifetime to a month)
    resources = []
    for r in inv:
        st = stats.get(r["id"])
        cost = monthly_cost(r, st)
        if st and st["days_of_data"] > 0:
            cost["network"] = round(st["egress_gb_30d"] * C.EGRESS_INR_PER_GB * C.DAYS / st["days_of_data"] * DAYS_PER_MONTH / C.DAYS)
            cost["total"] = cost["compute"] + cost["storage"] + cost["network"] + cost["ip"]
        light = {k: v for k, v in (st or {}).items() if k not in ("hourly_cpu", "heatmap_cpu")}
        public = {k: v for k, v in r.items() if k != "persona"}   # the engine never sees the planted label
        resources.append({**public, "cost": cost, "stats": light or None,
                          "profile": st["heatmap_cpu"] if st else None})   # weekday x hour avg CPU (what-if conflicts)
        if st:
            (OUT / "series" / f"{r['id']}.json").write_text(json.dumps(
                {"start": C.START, "step_min": 30, **downsample(series[r["id"]]),
                 "hourly_cpu": st["hourly_cpu"], "heatmap_cpu": st["heatmap_cpu"]}, separators=(",", ":")))

    by_id = {r["id"]: r for r in resources}
    recs = []
    for r in vms:
        anomaly = robust_anomaly(series[r["id"]]["cpu"])
        if anomaly:
            # don't size on abnormal data: it would "learn" the incident and recommend an upsize
            days = (C.N_POINTS - anomaly[0]) / C.POINTS_PER_DAY
            st = stats[r["id"]]
            recs.append({"resource_id": r["id"], "resource_name": r["name"], "resource_type": "vm", "env": r["env"],
                         "region": r["region"], "team": r["team"], "current_plan": r["plan"], "target_plan": None,
                         "action": "investigate", "title": "Sizing paused: investigate anomaly first",
                         "reason": (f"The last {days:.1f} days look abnormal (see Alerts). Sizing on this data would wrongly "
                                    f"recommend an upsize to absorb a probable runaway process. Fix the cause, then re-run."),
                         "saving": 0, "risk": "HIGH", "confidence": 30,
                         "confidence_notes": ["metrics contain an active anomaly: sizing data is not representative"],
                         "maths": [f"p99 CPU including the incident = {st['cpu_p99']:.0f}% → would trigger the upsize rule (> {C.UNDER_P99:.0f}%)",
                                   "Rule: VMs with an open anomaly alert are excluded from rightsizing"],
                         "vcpu_removed": 0, "peak_check": None})
            continue
        recs += recommend_vm(r, stats[r["id"]], by_id[r["id"]]["cost"])
    for r in inv:
        if r["type"] in ("volume", "ip") and r["attached_to"] is None:
            rec = recommend_orphan(r, NOW)
            if rec:
                recs.append(rec)
    for i, rec in enumerate(recs):
        rec["id"] = f"rec-{i + 1:03d}"
        rec["saving"] = round(rec["saving"])
        rec["carbon"] = carbon_kg(max(0.0, rec.get("vcpu_removed", 0) or 0))
        rec["default_accepted"] = rec["action"] not in ("review", "keep", "investigate")

    daily = daily_costs(inv, series)
    current_month = sum(r["cost"]["total"] for r in resources)
    projected_month = daily[-1]["inr"] * DAYS_PER_MONTH
    recs_by_vm = {}
    for rec in recs:
        recs_by_vm.setdefault(rec["resource_id"], []).append(rec)
    alerts = build_alerts(vms, stats, series, daily, projected_month, recs_by_vm)

    y = [d["inr"] for d in daily]
    fc, band, sigma = holt_winters(y, horizon=90)
    mape = backtest(y)
    last = pd.Timestamp(daily[-1]["date"])
    forecast = {"history": daily, "mape_7d": round(mape, 1), "sigma": round(sigma),
                "forecast": [{"date": (last + pd.Timedelta(days=h + 1)).date().isoformat(), "inr": round(float(fc[h])),
                              "lo": round(float(fc[h] - band[h])), "hi": round(float(fc[h] + band[h]))} for h in range(90)],
                "budget_monthly": C.MONTHLY_BUDGET_INR}

    def group(key):
        out = {}
        for r in resources:
            out[r[key]] = out.get(r[key], 0) + r["cost"]["total"]
        return {k: round(v) for k, v in sorted(out.items(), key=lambda kv: -kv[1])}

    actionable = [r for r in recs if r["default_accepted"] and r["saving"] > 0]
    summary = {
        "generated_at": NOW, "window_days": C.DAYS, "step_min": C.STEP_MIN,
        "n_resources": len(inv), "n_vms": len(vms),
        "n_points": int(len(vms) * C.N_POINTS * len(METRICS)),
        "current_monthly": round(current_month), "projected_next_month": round(projected_month),
        "budget_monthly": C.MONTHLY_BUDGET_INR,
        "potential_saving": round(sum(r["saving"] for r in actionable)),
        "by_env": group("env"), "by_region": group("region"), "by_team": group("team"), "by_type": group("type"),
        "by_component": {k: round(sum(r["cost"][k] for r in resources)) for k in ("compute", "storage", "network", "ip")},
        "bill_history": bill_history(projected_month),
        "counts": {a: sum(1 for r in recs if r["action"] == a) for a in
                   ["resize", "schedule", "stop", "review", "delete_volume", "release_ip", "upsize", "keep", "investigate"]},
    }
    assumptions = {k: getattr(C, k) for k in dir(C) if k.isupper()}
    assumptions["OFF_HOURS_FRACTION"] = round(C.off_hours_fraction(), 4)

    fleet = fleet_rollup(vms, series, stats)

    for name, obj in [("fleet", fleet), ("resources", resources), ("recommendations", recs), ("alerts", alerts),
                      ("forecast", forecast), ("summary", summary), ("assumptions", assumptions)]:
        (OUT / f"{name}.json").write_text(json.dumps(obj, indent=1, ensure_ascii=False, default=float))

    print(f"current ₹{current_month:,.0f}/month, projected ₹{projected_month:,.0f}, "
          f"potential saving ₹{summary['potential_saving']:,.0f} ({summary['potential_saving'] / current_month:.0%})")
    print("counts", summary["counts"])
    print(f"{len(alerts)} alerts:", [a["title"] for a in alerts])
    print(f"forecast backtest MAPE {mape:.1f}%")


if __name__ == "__main__":
    main()
