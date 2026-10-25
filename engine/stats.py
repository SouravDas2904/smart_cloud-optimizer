"""Per-resource statistics computed from the raw 5-minute series."""
from __future__ import annotations

import numpy as np

import config as C
from generate import HOUR, IS_WEEKEND, WEEKDAY


def pct(x, q):
    x = x[~np.isnan(x)]
    return float(np.percentile(x, q)) if x.size else 0.0


def off_mask(start=C.OFF_START_HOUR, end=C.OFF_END_HOUR, weekends=C.OFF_WEEKENDS):
    night = (HOUR >= start) | (HOUR < end) if start > end else (HOUR >= start) & (HOUR < end)
    return night | IS_WEEKEND if weekends else night


def daily_trend(x: np.ndarray, days=C.TREND_DAYS) -> dict:
    """Least-squares line through the daily p95 of the last `days` days.

    slope   = % per day,  level = the fitted p95 today,  r2 = share of the day-to-day variation the line explains.
    Daily p95 (not every 5-min reading) so the daily cycle doesn't hide or fake a trend.
    """
    if C.DAYS < days:                                                   # short upload: not enough days for a trend
        return {"slope": 0.0, "level": 0.0, "r2": 0.0}
    days_x = [x[d * C.POINTS_PER_DAY:(d + 1) * C.POINTS_PER_DAY] for d in range(C.DAYS - days, C.DAYS)]
    ok = np.array([np.isfinite(v).mean() > 0.5 for v in days_x])      # skip days the VM didn't exist / agent was down
    if ok.sum() < 7:
        return {"slope": 0.0, "level": 0.0, "r2": 0.0}
    daily = np.array([pct(v, 95) for v in days_x])[ok]
    t = np.arange(days, dtype=float)[ok]
    slope, icpt = np.polyfit(t, daily, 1)
    fit = icpt + slope * t
    ss_tot = float(((daily - daily.mean()) ** 2).sum())
    r2 = 1 - float(((daily - fit) ** 2).sum()) / ss_tot if ss_tot > 0 else 0.0
    return {"slope": round(float(slope), 3), "level": round(float(fit[-1]), 1), "r2": round(r2, 2)}


def vm_stats(s: dict[str, np.ndarray]) -> dict:
    cpu, mem = s["cpu"], s["mem"]
    valid = ~np.isnan(cpu)
    days_of_data = valid.sum() / C.POINTS_PER_DAY
    # fraction missing *after* the VM existed (gaps), not before it was created
    first = int(np.argmax(valid)) if valid.any() else 0
    missing = float(np.isnan(cpu[first:]).mean())

    off = off_mask()
    work = (HOUR >= 9) & (HOUR < 19) & ~IS_WEEKEND
    cv = float(np.nanstd(cpu) / max(np.nanmean(cpu), 1e-6))

    # hourly profile and a weekday x hour heat-map of average CPU
    hour_idx = HOUR.astype(int)
    # night jobs: hours of the day whose off-window readings have a p95 above the busy threshold
    busy = [h for h in range(24) if (off & (hour_idx == h)).any() and pct(cpu[off & (hour_idx == h)], 95) > C.OFFHOURS_BUSY_P95]
    hourly = [round(float(np.nanmean(cpu[hour_idx == h])), 1) for h in range(24)]
    heat = [[round(float(np.nanmean(cpu[(WEEKDAY == d) & (hour_idx == h)])), 1) for h in range(24)] for d in range(7)]

    # disk growth: linear fit over the last 14 days (or the whole window if it is shorter)
    last = min(14, C.DAYS) * C.POINTS_PER_DAY
    d = s["disk"][-last:]
    ok = ~np.isnan(d)
    slope_per_day = 0.0
    if ok.sum() > 100:
        x = np.arange(last)[ok] / C.POINTS_PER_DAY
        slope_per_day = float(np.polyfit(x, d[ok], 1)[0])
    disk_now = float(np.nanmean(s["disk"][-C.POINTS_PER_DAY // 4:]))

    trend = {"cpu": daily_trend(cpu), "mem": daily_trend(mem)}

    net = s["net_in"] + s["net_out"]
    egress_gb = float(np.nansum(s["net_out"]) * C.STEP_MIN * 60 / 1024)   # MB/s * seconds -> GB

    return {
        "cpu_avg": round(float(np.nanmean(cpu)), 2),
        "cpu_p50": round(pct(cpu, 50), 2),
        "cpu_p95": round(pct(cpu, 95), 2),
        "cpu_p99": round(pct(cpu, 99), 2),
        "cpu_max": round(pct(cpu, 100), 2),
        "mem_avg": round(float(np.nanmean(mem)), 2),
        "mem_p95": round(pct(mem, 95), 2),
        "mem_p99": round(pct(mem, 99), 2),
        "mem_max": round(pct(mem, 100), 2),
        "cpu_time_above_80": round(float(np.nanmean(cpu[valid] > 80) * 100), 2),
        "offhours_cpu_avg": round(float(np.nanmean(cpu[off])), 2),
        "offhours_cpu_p99": round(pct(cpu[off], 99), 2),
        "offhours_busy_hours": busy,
        "offhours_quiet_avg": round(float(np.nanmean(cpu[off & ~np.isin(hour_idx, busy)])) if (off & ~np.isin(hour_idx, busy)).any() else 0.0, 2),
        "work_cpu_avg": round(float(np.nanmean(cpu[work])), 2),
        "net_p95_mbps": round(pct(net, 95), 3),
        "iops_p95": round(pct(s["iops"], 95), 1),
        "disk_now": round(disk_now, 1),
        "disk_slope_per_day": round(slope_per_day, 3),
        "egress_gb_30d": round(egress_gb, 1),
        "cv": round(cv, 2),
        "days_of_data": round(float(days_of_data), 1),
        "missing_frac": round(missing, 3),
        "cpu_trend": trend["cpu"],
        "mem_trend": trend["mem"],
        "hourly_cpu": hourly,
        "heatmap_cpu": heat,
    }
