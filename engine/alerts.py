"""Alerts & insights. Every alert carries a plain-English `why`."""
from __future__ import annotations

import numpy as np
import pandas as pd

import config as C
from generate import HOUR, IS_WEEKEND, START

INR = lambda x: f"₹{x:,.0f}"


def _baseline(x: np.ndarray, train_days: int):
    """Median and MAD per (weekday/weekend, hour) slot from the training window.

    Using a seasonal baseline means a VM that spikes at 10:00 *every day* is normal at
    10:00, so daily report jobs never trigger false anomalies.
    """
    n = train_days * C.POINTS_PER_DAY
    hour = HOUR.astype(int)
    med = np.full((2, 24), np.nan)      # a slot with no training data scores nothing (short uploads lack weekends)
    mad = np.zeros((2, 24))
    for w in (0, 1):
        for h in range(24):
            sel = (hour[:n] == h) & (IS_WEEKEND[:n] == bool(w))
            v = x[:n][sel]
            v = v[~np.isnan(v)]
            if v.size:
                m = np.median(v)
                med[w, h] = m
                mad[w, h] = np.median(np.abs(v - m))
    return med, mad


def robust_anomaly(x: np.ndarray, train_days=None, floor=2.0):
    """Return (start_idx, end_idx, peak_z, baseline_median) of the longest run with z > threshold.

    Learns the normal pattern from the first 70% of the window (21 of 30 days) and scores the rest.
    """
    if C.DAYS < C.ANOMALY_MIN_DAYS:
        return None
    train_days = train_days or round(C.DAYS * 0.7)
    if np.isnan(x[: train_days * C.POINTS_PER_DAY]).mean() > 0.5:
        return None
    med, mad = _baseline(x, train_days)
    hour = HOUR.astype(int)
    w = IS_WEEKEND.astype(int)
    scale = np.maximum(1.4826 * mad[w, hour], floor)
    z = np.nan_to_num((x - med[w, hour]) / scale)
    z[: train_days * C.POINTS_PER_DAY] = 0
    hot = np.nan_to_num(z) > C.ANOMALY_Z
    best, run_start = None, None
    for i, h in enumerate(np.append(hot, False)):
        if h and run_start is None:
            run_start = i
        elif not h and run_start is not None:
            if i - run_start >= C.ANOMALY_MIN_POINTS and (best is None or i - run_start > best[1] - best[0]):
                best = (run_start, i)
            run_start = None
    if best is None:
        return None
    s, e = best
    return s, e, float(np.max(z[s:e])), float(np.nanmedian(med))


def ts(i: int) -> str:
    return (START + pd.Timedelta(minutes=int(i) * C.STEP_MIN)).isoformat()


def build_alerts(vms, stats, series, daily_cost, projected_month, recs_by_vm):
    alerts = []
    n_end = C.N_POINTS

    for r in vms:
        s, st = series[r["id"]], stats[r["id"]]
        # usage anomaly on CPU, with network-out as corroboration
        a = robust_anomaly(s["cpu"])
        if a:
            i0, i1, z, base = a
            hours = (i1 - i0) * C.STEP_MIN / 60
            pre_out = float(np.nanmean(s["net_out"][: i0]))
            post_out = float(np.nanmean(s["net_out"][i0:i1]))
            ratio = post_out / max(pre_out, 1e-6)
            extra_gb = (post_out - pre_out) * (i1 - i0) * C.STEP_MIN * 60 / 1024
            extra_inr = max(0.0, extra_gb * C.EGRESS_INR_PER_GB)
            alerts.append({
                "id": f"anom-{r['id']}", "kind": "anomaly", "severity": "critical", "resource_id": r["id"],
                "resource_name": r["name"], "team": r["team"], "env": r["env"], "region": r["region"],
                "title": f"Abnormal CPU on {r['name']}",
                "why": (f"Since {ts(i0)[:16].replace('T', ' ')} CPU has been at ~{np.nanmean(s['cpu'][i0:i1]):.0f}% for {hours:.0f} hours "
                        f"(its normal level before that was ~{np.nanmean(s['cpu'][:i0]):.0f}%; robust z-score {z:.0f}, threshold {C.ANOMALY_Z:.0f}). "
                        f"Network-out is {ratio:.0f}× normal. Looks like a runaway process or a compromised host. "
                        f"Extra egress so far: {extra_gb:,.0f} GB ≈ {INR(extra_inr)}."),
                "metric": "cpu", "start": ts(i0), "end": ts(i1 - 1), "cost_impact": round(extra_inr),
            })

        # capacity: disk heading to full
        if st["disk_slope_per_day"] > 0.05:
            days_left = (C.CAPACITY_WARN_PCT - st["disk_now"]) / st["disk_slope_per_day"]
            if 0 < days_left < C.CAPACITY_HORIZON_DAYS:
                alerts.append({
                    "id": f"disk-{r['id']}", "kind": "capacity", "severity": "warning", "resource_id": r["id"],
                    "resource_name": r["name"], "team": r["team"], "env": r["env"], "region": r["region"],
                    "title": f"Disk filling up on {r['name']}",
                    "why": (f"Disk is {st['disk_now']:.0f}% full and has grown {st['disk_slope_per_day']:.2f}% per day over the last 14 days "
                            f"(linear fit). At this rate it reaches {C.CAPACITY_WARN_PCT:.0f}% in about {days_left:.0f} days. "
                            f"Expand the volume or clean up logs before then."),
                    "metric": "disk", "days_left": round(days_left, 1), "cost_impact": 0,
                })

        # capacity: CPU or memory trending toward the limit (linear fit of the daily p95, see stats.daily_trend)
        for metric, label in (("cpu", "CPU"), ("mem", "Memory")):
            tr = st[f"{metric}_trend"]
            if a or tr["slope"] < C.TREND_MIN_SLOPE or tr["r2"] < C.TREND_MIN_R2 or tr["level"] >= C.CAPACITY_WARN_PCT:
                continue
            days_left = (C.CAPACITY_WARN_PCT - tr["level"]) / tr["slope"]
            if days_left < C.CAPACITY_HORIZON_DAYS:
                alerts.append({
                    "id": f"{metric}trend-{r['id']}", "kind": "capacity", "severity": "warning", "resource_id": r["id"],
                    "resource_name": r["name"], "team": r["team"], "env": r["env"], "region": r["region"],
                    "title": f"{label} climbing toward its limit on {r['name']}",
                    "why": (f"Daily peak (p95) {label.lower()} is {tr['level']:.0f}% and has risen {tr['slope']:.2f}% per day over the last "
                            f"{C.TREND_DAYS} days (straight-line fit, R² {tr['r2']:.2f}). At this rate it passes {C.CAPACITY_WARN_PCT:.0f}% "
                            f"in about {days_left:.0f} days. "
                            + ("A steady climb in memory with flat traffic usually means a memory leak: check the last deploy."
                               if metric == "mem" else "Plan an upsize or find what is driving the growth.")),
                    "metric": metric, "days_left": round(days_left, 1), "cost_impact": 0,
                })

        # capacity: CPU saturated (an anomalous VM is already covered by its anomaly alert)
        if st["cpu_p99"] > C.UNDER_P99 and not a:
            alerts.append({
                "id": f"cpu-{r['id']}", "kind": "capacity", "severity": "warning", "resource_id": r["id"],
                "resource_name": r["name"], "team": r["team"], "env": r["env"], "region": r["region"],
                "title": f"{r['name']} is near its CPU limit",
                "why": (f"p99 CPU is {st['cpu_p99']:.0f}% and it spends {st['cpu_time_above_80']:.0f}% of the time above 80%. "
                        f"Requests slow down at peak. An upsize recommendation is available."),
                "metric": "cpu", "cost_impact": 0,
            })

    # sudden daily cost jump
    dc = np.array([d["inr"] for d in daily_cost])
    for i in range(7, len(dc)):
        trailing = dc[i - 7:i].mean()
        jump = (dc[i] - trailing) / trailing * 100
        if jump > C.COST_JUMP_PCT:
            new = [r for r in vms if r["created_at"][:10] == daily_cost[i]["date"]]
            detail = ""
            if new:
                plans = {r["plan"] for r in new}
                detail = (f" {len(new)} new {', '.join(sorted(plans))} VMs were launched that day by the "
                          f"{new[0]['team']} team in {new[0]['region']} (+{INR(sum(C.PLANS[r['plan']][2] for r in new))}/month).")
            alerts.append({
                "id": f"cost-{daily_cost[i]['date']}", "kind": "cost_jump", "severity": "warning",
                "title": f"Daily cost jumped {jump:.0f}% on {daily_cost[i]['date']}",
                "why": f"Daily spend went from a 7-day average of {INR(trailing)} to {INR(dc[i])}.{detail}",
                "date": daily_cost[i]["date"], "cost_impact": round((dc[i] - trailing) * 30),
            })
            break

    # projected budget overrun
    if projected_month > C.MONTHLY_BUDGET_INR:
        over = projected_month - C.MONTHLY_BUDGET_INR
        alerts.append({
            "id": "budget", "kind": "budget", "severity": "critical",
            "title": f"Projected to exceed budget by {INR(over)}",
            "why": (f"At the current daily run-rate ({INR(dc[-1])}/day, which includes the new ML VMs and the anomaly's egress) "
                    f"next month will cost about {INR(projected_month)} against a budget of {INR(C.MONTHLY_BUDGET_INR)} "
                    f"(+{over / C.MONTHLY_BUDGET_INR:.0%}). Accepting the recommendations closes the gap."),
            "cost_impact": round(over),
        })

    order = {"critical": 0, "warning": 1, "info": 2}
    return sorted(alerts, key=lambda a: (order[a["severity"]], -a.get("cost_impact", 0)))
