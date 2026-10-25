"""Writes the simulated estate in the upload format (DATA_FORMAT.md): a ready-made example of correct files.

    python engine/make_sample_csv.py <out_dir>                     # the whole estate, 5-minute readings
    python engine/make_sample_csv.py <out_dir> --vms 12 --step 15  # a small sample (public/samples/)

Loading the full export with `build.py --data` gives the same recommendations as the simulated build,
which is how the loader is tested (tests/test_csv_loader.py).
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import pandas as pd

import config as C
from generate import DATA_DIR, METRICS

COLS = {"cpu": "cpu_pct", "mem": "mem_pct", "disk": "disk_pct", "iops": "iops", "net_in": "net_in_mbps", "net_out": "net_out_mbps"}
# the demo's showcase VMs go into the small sample first
SHOWCASE = ["prod-reports-01", "dev-search-04", "prod-pay-api-07"]


def main(out: Path, n_vms: int | None, step: int):
    out.mkdir(parents=True, exist_ok=True)
    inv = json.loads((DATA_DIR / "inventory.json").read_text())
    z = np.load(DATA_DIR / "metrics.npz")
    ids = list(z["ids"])
    vms = [r for r in inv if r["type"] == "vm"]
    if n_vms:
        by_name = {r["name"]: r for r in vms}
        first = [by_name[n] for n in SHOWCASE if n in by_name]
        seen, pick = set(), []
        for r in first + vms:   # then one VM per workload pattern so the sample triggers every rule
            key = r["name"] if r in first else (r.get("persona"), r["env"], r["created_at"] > C.START)
            if key not in seen and len(pick) < n_vms:
                seen.add(key)
                pick.append(r)
        vms = pick
    keep = {r["id"] for r in vms}
    others = [r for r in inv if r["type"] != "vm" and r["attached_to"] in keep]
    orphans = [r for r in inv if r["type"] != "vm" and r["attached_to"] is None]
    others += orphans[:4] if n_vms else orphans
    rows = vms + others

    with (out / "inventory.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        cols = ["id", "name", "type", "region", "env", "team", "created_at", "plan", "vcpu", "ram_gb", "disk_gb", "attached_to", "detached_since"]
        w.writerow(cols)
        for r in rows:
            vm = r["type"] == "vm"
            w.writerow([r["id"], r["name"], r["type"], r["region"], r["env"], r["team"], r["created_at"][:19].replace("T", " "),
                        r["plan"] or "", r["vcpu"] if vm else "", r["ram_gb"] if vm else "", r["disk_gb"] if r["type"] != "ip" else "",
                        r["attached_to"] or "", (r["detached_since"] or "")[:19].replace("T", " ")])

    ts = pd.date_range(C.START, periods=C.N_POINTS, freq=f"{C.STEP_MIN}min").strftime("%Y-%m-%d %H:%M")
    every = step // C.STEP_MIN
    n = 0
    with (out / "metrics.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "vm_id"] + [COLS[m] for m in METRICS])
        for r in vms:
            i = ids.index(r["id"])
            cols = [z[m][i].astype(float) for m in METRICS]
            for t in range(0, C.N_POINTS, every):
                if every > 1:   # a coarser agent: average CPU/mem/... over its interval, like real monitoring does
                    vals = [np.nanmean(c[t:t + every]) if not np.isnan(c[t:t + every]).all() else np.nan for c in cols]
                else:
                    vals = [c[t] for c in cols]
                if np.isnan(vals[0]):
                    continue   # VM not created yet, or an agent outage
                w.writerow([ts[t], r["id"]] + [round(float(v), 3) for v in vals])
                n += 1

    plans = list(C.PLANS)   # every size, so the engine has resize targets
    with (out / "pricing.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["plan", "vcpu", "ram_gb", "price_inr_month"])
        for p in plans:
            v, m, price = C.PLANS[p]
            w.writerow([p, v, m, price])

    with (out / "rates.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "value"])
        for k, v in [("block_inr_per_gb_month", C.BLOCK_INR_PER_GB_MONTH), ("snapshot_inr_per_gb_month", C.SNAPSHOT_INR_PER_GB_MONTH),
                     ("public_ip_inr_per_month", C.PUBLIC_IP_INR_PER_MONTH), ("egress_inr_per_gb", C.EGRESS_INR_PER_GB),
                     ("monthly_budget_inr", C.MONTHLY_BUDGET_INR if not n_vms else 120000)]:
            w.writerow([k, v])
    print(f"{out}: {len(rows)} resources ({len(vms)} VMs), {n:,} metric rows every {step} min")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--vms", type=int, default=None)
    ap.add_argument("--step", type=int, default=5, choices=[5, 10, 15, 30, 60])
    a = ap.parse_args()
    main(a.out, a.vms, a.step)
