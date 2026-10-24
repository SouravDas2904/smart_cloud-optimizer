"""All assumptions in one place. Every number the engine produces traces back here.

Prices are ILLUSTRATIVE (the PS allows this). Replace PLANS / unit prices with a real
price list and nothing else in the engine needs to change.
"""

SEED = 42
DAYS = 30
STEP_MIN = 5
POINTS_PER_DAY = 24 * 60 // STEP_MIN          # 288
N_POINTS = DAYS * POINTS_PER_DAY              # 8640
START = "2026-09-24T00:00:00+05:30"           # IST; window ends 2026-10-23 23:55

HOURS_PER_MONTH = 730

REGIONS = ["Noida", "Bangalore", "Mumbai"]
TEAMS = ["Payments", "Search", "Platform", "Data", "Mobile-API", "Growth"]

# plan -> (vCPU, RAM GB, INR per month). Hourly = monthly / 730.
# "s-" = standard, "m-" = memory-optimised (more RAM per vCPU).
PLANS = {
    "s-2-4":   (2, 4, 1500),
    "s-2-8":   (2, 8, 2000),
    "m-2-16":  (2, 16, 2600),
    "s-4-8":   (4, 8, 3000),
    "s-4-16":  (4, 16, 4000),
    "m-4-32":  (4, 32, 5000),
    "s-8-16":  (8, 16, 6000),
    "s-8-32":  (8, 32, 8000),
    "m-8-64":  (8, 64, 9500),
    "s-16-32": (16, 32, 12000),
    "s-16-64": (16, 64, 16000),
}
PLAN_ORDER = list(PLANS)  # used for "next size up"

BLOCK_INR_PER_GB_MONTH = 6.0      # billed whether attached or not, and while the VM is stopped
SNAPSHOT_INR_PER_GB_MONTH = 2.0   # safety snapshot kept before deleting a volume
PUBLIC_IP_INR_PER_MONTH = 300.0   # billed whether assigned or not
EGRESS_INR_PER_GB = 0.80          # outbound network traffic

MONTHLY_BUDGET_INR = 850000       # budget leadership set for this month

# --- rightsizing ---
TARGET_CPU_UTIL = 0.70            # resized VM should run <= 70% at its p99 -> 30% headroom
TARGET_MEM_UTIL = 0.75            # memory exhaustion kills processes -> 25% buffer
MIN_MEM_MARGIN_GB = 1.0
MAX_CPU_CEILING = 0.95             # the single busiest 5-min reading must stay below 95% after a resize
                                  # (catches spikes shorter than ~15 min/day that p99 cannot see)

# --- classification thresholds ---
IDLE_CPU_P95 = 5.0                # %
IDLE_NET_P95_MBPS = 0.5           # in + out, MB/s
IDLE_IOPS_P95 = 10.0
IDLE_MIN_DAYS = 14
UNDER_P99 = 90.0                  # % -> upsize
ORPHAN_GRACE_DAYS = 7
OFFHOURS_CPU_MAX = 5.0            # avg CPU in the off window to be "schedulable"
OFF_START_HOUR = 20               # 8 PM IST
OFF_END_HOUR = 8                  # 8 AM IST
OFF_WEEKENDS = True

# --- alerts ---
ANOMALY_Z = 4.0                   # robust z-score
ANOMALY_MIN_POINTS = 6            # 6 x 5 min = 30 min sustained
COST_JUMP_PCT = 15.0              # daily cost vs trailing 7-day average
CAPACITY_WARN_PCT = 90.0
CAPACITY_HORIZON_DAYS = 21

# --- sustainability ---
WATTS_PER_VCPU = 4.0
PUE = 1.4
GRID_KG_CO2_PER_KWH = 0.716       # India grid (CEA)
KG_CO2_PER_TREE_YEAR = 21.0


def plan_hourly(plan: str) -> float:
    return PLANS[plan][2] / HOURS_PER_MONTH


def off_hours_fraction(start=OFF_START_HOUR, end=OFF_END_HOUR, weekends=OFF_WEEKENDS) -> float:
    """Share of the 168 weekly hours that fall in the shutdown window."""
    nightly = (24 - start + end) % 24 if start != end else 0
    if weekends:
        return (nightly * 5 + 48) / 168
    return nightly * 7 / 168
