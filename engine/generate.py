"""Builds the simulated cloud estate: inventory + 30 days of 5-minute metrics.

Every VM is given a workload "persona" (steady-low, bursty, office-hours dev, ...)
so the estate contains exactly the patterns the UTHO brief asks for. The random
seed is fixed, so every run produces the same numbers (reproducible demo).

    value(t) = base + daily_shape(hour) * weekday_factor(day) + noise + events(t)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np
import pandas as pd

import config as C

DATA_DIR = Path(__file__).parent / "data"
METRICS = ["cpu", "mem", "disk", "iops", "net_in", "net_out"]

rng = np.random.default_rng(C.SEED)

T = np.arange(C.N_POINTS)
HOUR = (T % C.POINTS_PER_DAY) * C.STEP_MIN / 60.0           # fractional hour of day
DAY = T // C.POINTS_PER_DAY
START = pd.Timestamp(C.START)
WEEKDAY = np.array([(START + pd.Timedelta(days=int(d))).weekday() for d in range(C.DAYS)])[DAY]
IS_WEEKEND = WEEKDAY >= 5


@dataclass
class Resource:
    id: str
    name: str
    type: str                 # vm | volume | ip
    region: str
    env: str                  # prod | staging | dev
    team: str
    created_at: str
    plan: str | None = None
    vcpu: int = 0
    ram_gb: int = 0
    disk_gb: int = 0
    attached_to: str | None = None
    detached_since: str | None = None
    persona: str | None = None
    notes: str = ""
    tags: dict = field(default_factory=dict)


def noise(sigma, n=C.N_POINTS):
    return rng.normal(0, sigma, n)


def bump(center_hour, width_hours, height):
    """Smooth daily bump (e.g. office hours, a 10 AM report run)."""
    d = np.minimum(np.abs(HOUR - center_hour), 24 - np.abs(HOUR - center_hour))
    return height * np.exp(-0.5 * (d / width_hours) ** 2)


def window(start_hour, end_hour, height):
    """Flat block between two hours of the day."""
    return np.where((HOUR >= start_hour) & (HOUR < end_hour), height, 0.0)


def clip(x, lo=0.0, hi=100.0):
    return np.clip(x, lo, hi)


# ----------------------------------------------------------------- personas
# Each returns cpu, mem (both %) and a "network activity" scale used for net/iops.

def p_steady_low():
    cpu = 6 + rng.uniform(0, 4) + noise(1.5) + bump(14, 3, 3)
    mem = 22 + rng.uniform(0, 8) + noise(1.5)
    return cpu, mem, 0.6


def p_healthy():
    base = rng.uniform(38, 52)
    cpu = base + bump(14, 4, 12) + noise(4)
    mem = rng.uniform(50, 62) + noise(2.5)
    return cpu, mem, 1.5


def p_bursty(peak_hour=None):
    # The trap: average looks low, but a short daily spike is close to the ceiling.
    h = peak_hour if peak_hour is not None else rng.choice([10, 11, 18])
    cpu = 9 + noise(2) + window(h, h + 0.5, rng.uniform(70, 76))
    mem = 35 + noise(2) + window(h, h + 0.5, 20)
    return cpu, mem, 1.0


def p_batch():
    h = rng.choice([1, 2, 3])
    cpu = 2 + noise(0.6) + window(h, h + 2, rng.uniform(74, 80))
    mem = 20 + noise(1) + window(h, h + 2, 45)
    return cpu, mem, 0.8


def p_office_dev():
    work = (HOUR >= 9) & (HOUR < 19) & ~IS_WEEKEND
    cpu = np.where(work, rng.uniform(12, 22) + bump(15, 2.5, 8), 1.2) + noise(1.0)
    mem = np.where(work, 40, 28) + noise(1.5)
    return cpu, mem, 0.5


def p_idle():
    cpu = 1.0 + rng.uniform(0, 0.8) + noise(0.3)
    mem = 12 + rng.uniform(0, 6) + noise(0.5)
    return cpu, mem, 0.02


def p_memory_heavy():
    cpu = 9 + noise(2) + bump(14, 3, 4)
    mem = rng.uniform(72, 78) + noise(2) + bump(14, 3, 4)
    return cpu, mem, 1.0


def p_under():
    cpu = 72 + bump(14, 4, 22) + noise(4)
    mem = 70 + noise(3)
    return cpu, mem, 2.0


def p_growing_disk():
    cpu, mem, net = p_healthy()
    return cpu, mem, net


PERSONAS = {
    "steady_low": p_steady_low, "healthy": p_healthy, "bursty": p_bursty, "batch": p_batch,
    "office_dev": p_office_dev, "idle": p_idle, "memory_heavy": p_memory_heavy,
    "under": p_under, "growing_disk": p_growing_disk,
}


# ----------------------------------------------------------------- estate design
# (persona, env, plan, count). Names are generated from team + role.
DESIGN = [
    ("steady_low",   "prod",    "s-8-32",  6), ("steady_low", "staging", "s-8-16", 5),
    ("steady_low",   "dev",     "s-4-16",  7),
    ("healthy",      "prod",    "s-8-16", 10), ("healthy", "prod", "s-4-8", 6),
    ("bursty",       "prod",    "s-8-16",  5),
    ("batch",        "prod",    "s-8-32",  4), ("batch", "staging", "s-4-16", 2),
    ("office_dev",   "dev",     "s-8-32",  8), ("office_dev", "dev", "s-4-16", 7),
    ("office_dev",   "staging", "s-8-16",  5),
    ("idle",         "dev",     "s-4-8",   4), ("idle", "staging", "s-8-16", 2),
    ("idle",         "prod",    "s-4-16",  2),
    ("memory_heavy", "prod",    "s-8-16",  4), ("memory_heavy", "staging", "s-8-16", 2),
    ("under",        "prod",    "s-4-8",   4),
    ("growing_disk", "prod",    "s-8-32",  2),
]
ROLES = {
    "Payments": ["pay-api", "ledger", "upi-gw", "billing"],
    "Search": ["search", "indexer", "es-node", "ranker"],
    "Platform": ["auth", "gateway", "redis", "kafka"],
    "Data": ["etl", "warehouse", "airflow", "spark"],
    "Mobile-API": ["mob-bff", "push", "media", "cdn-origin"],
    "Growth": ["crm", "mailer", "reports", "ab-test"],
}
ENV_PREFIX = {"prod": "prod", "staging": "stg", "dev": "dev"}


def iso(day: float) -> str:
    return (START + pd.Timedelta(days=day)).isoformat()


def build():
    resources: list[Resource] = []
    series: dict[str, dict[str, np.ndarray]] = {}
    name_count: dict[str, int] = {}

    reserved = {"prod-reports-01", "dev-search-04", "prod-pay-api-07"}   # showcase VMs added below

    def new_name(env, team):
        role = rng.choice(ROLES[team])
        base = f"{ENV_PREFIX[env]}-{role}"
        while True:
            name_count[base] = name_count.get(base, 0) + 1
            name = f"{base}-{name_count[base]:02d}"
            if name not in reserved:
                return name

    def add_vm(persona, env, plan, *, team=None, region=None, name=None, created_day=None, cpu_mem=None):
        team = team or rng.choice(C.TEAMS)
        region = region or rng.choice(C.REGIONS)
        vcpu, ram, _ = C.PLANS[plan]
        vid = f"vm-{len([r for r in resources if r.type == 'vm']) + 1:03d}"
        # launch dates spread over ~2 years; build.py turns them into the monthly bill history
        created = created_day if created_day is not None else -rng.uniform(40, 700)
        r = Resource(id=vid, name=name or new_name(env, team), type="vm", region=region, env=env,
                     team=team, created_at=iso(created), plan=plan, vcpu=vcpu, ram_gb=ram,
                     disk_gb=int(rng.choice([50, 100, 200, 500])), persona=persona)
        cpu, mem, net = cpu_mem if cpu_mem else PERSONAS[persona]()
        disk = np.full(C.N_POINTS, rng.uniform(30, 65)) + noise(0.3)
        if persona == "growing_disk":
            disk = 60 + T / C.POINTS_PER_DAY * 0.65 + noise(0.2)   # ~+0.65%/day -> ~79% now
        activity = clip(cpu, 0, 100) / 100
        iops = clip(net * 40 + activity * 900 * net + noise(5), 0, None)
        net_in = clip(net * (0.4 + activity * 2.5) + noise(0.03), 0, None)
        net_out = clip(net * (0.3 + activity * 2.0) + noise(0.03), 0, None)
        s = {"cpu": clip(cpu), "mem": clip(mem), "disk": clip(disk), "iops": iops,
             "net_in": net_in, "net_out": net_out}
        if created_day is not None and created_day > 0:          # did not exist before
            cut = int(created_day * C.POINTS_PER_DAY)
            for k in s:
                s[k] = s[k].astype(float)
                s[k][:cut] = np.nan
        resources.append(r)
        series[vid] = s
        return r, s

    # 1) the designed estate
    for persona, env, plan, count in DESIGN:
        for _ in range(count):
            add_vm(persona, env, plan)

    # 2) named showcase VMs used in the demo
    add_vm("bursty", "prod", "s-8-16", team="Growth", region="Mumbai", name="prod-reports-01",
           cpu_mem=p_bursty(peak_hour=10))
    add_vm("steady_low", "dev", "s-8-32", team="Search", region="Mumbai", name="dev-search-04",
           cpu_mem=(5 + noise(1.5) + bump(14, 2.5, 9), 22 + noise(1.5) + bump(14, 2, 6), 0.5))
    # dev-search-04 also sleeps at night/weekends -> both resize and schedule apply
    s = series[resources[-1].id]
    off = ((HOUR >= 20) | (HOUR < 8)) | IS_WEEKEND
    s["cpu"] = np.where(off, clip(1.4 + noise(0.3)), s["cpu"])

    # 3) the anomaly: a prod VM that suddenly pegs CPU and sends 25x traffic from day 26.4
    r, s = add_vm("healthy", "prod", "s-8-16", team="Payments", region="Noida", name="prod-pay-api-07",
                  cpu_mem=(22 + bump(14, 4, 8) + noise(3), 48 + noise(2), 1.0))
    start = int(26.4 * C.POINTS_PER_DAY)
    s["cpu"][start:] = clip(97 + noise(1.5, C.N_POINTS - start))
    normal_out = float(np.nanmean(s["net_out"][:start]))
    s["net_out"][start:] = clip(normal_out * 25 + noise(normal_out, C.N_POINTS - start), 0, None)
    r.notes = "planted anomaly"

    # 4) the cost jump: Data team launched 8 large ML VMs in Mumbai on day 20
    for i in range(8):
        add_vm("healthy", "prod", "s-16-64", team="Data", region="Mumbai", name=f"prod-ml-train-{i + 1:02d}",
               created_day=20.0)

    # 5) a few metric gaps (agent outages) so the confidence score has something to react to
    for vid in ["vm-005", "vm-031", "vm-058"]:
        if vid in series:
            g0 = int(rng.uniform(3, 20) * C.POINTS_PER_DAY)
            gap = int(rng.uniform(1.5, 4) * C.POINTS_PER_DAY)
            for k in series[vid]:
                series[vid][k] = series[vid][k].astype(float)
                series[vid][k][g0:g0 + gap] = np.nan

    vms = [r for r in resources if r.type == "vm"]

    # 6) block volumes: one data volume per VM is folded into the VM (disk_gb); orphans are separate
    for i in range(10):
        team = rng.choice(C.TEAMS)
        detached = -rng.uniform(9, 120)
        resources.append(Resource(
            id=f"vol-{i + 1:03d}", name=f"{rng.choice(['old', 'tmp', 'backup', 'migr'])}-{rng.choice(ROLES[team])}-vol-{i + 1:02d}",
            type="volume", region=rng.choice(C.REGIONS), env=rng.choice(["dev", "staging", "prod"], p=[.5, .3, .2]),
            team=team, created_at=iso(detached - rng.uniform(30, 300)), disk_gb=int(rng.choice([100, 200, 250, 500])),
            attached_to=None, detached_since=iso(detached)))

    # 7) public IPs: prod VMs behind the gateway have one; 6 are reserved but unassigned
    ip_n = 0
    for v in [v for v in vms if v.env == "prod"][:30]:
        ip_n += 1
        resources.append(Resource(id=f"ip-{ip_n:03d}", name=f"eip-{v.name}", type="ip", region=v.region,
                                  env=v.env, team=v.team, created_at=v.created_at, attached_to=v.id))
    for i in range(6):
        ip_n += 1
        team = rng.choice(C.TEAMS)
        detached = -rng.uniform(10, 90)
        resources.append(Resource(id=f"ip-{ip_n:03d}", name=f"eip-unused-{i + 1:02d}", type="ip",
                                  region=rng.choice(C.REGIONS), env=rng.choice(["dev", "staging", "prod"]),
                                  team=team, created_at=iso(detached - 30), attached_to=None,
                                  detached_since=iso(detached)))
    return resources, series


def main():
    DATA_DIR.mkdir(exist_ok=True)
    resources, series = build()
    ids = [r.id for r in resources if r.type == "vm"]
    arrays = {m: np.stack([series[i][m] for i in ids]).astype(np.float32) for m in METRICS}
    np.savez_compressed(DATA_DIR / "metrics.npz", ids=np.array(ids), **arrays)
    (DATA_DIR / "inventory.json").write_text(json.dumps([asdict(r) for r in resources], indent=1))
    print(f"{len(resources)} resources ({len(ids)} VMs), {arrays['cpu'].size * len(METRICS):,} metric values")


if __name__ == "__main__":
    main()
