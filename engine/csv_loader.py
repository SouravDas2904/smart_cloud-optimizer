"""Bring your own data: checks a company's CSV files and turns them into the engine's input.

    python engine/build.py --data <folder>      # folder holds inventory.csv, metrics.csv, pricing.csv [, rates.csv]

The same code runs in the website (/upload, inside the browser) and on the command line. It is strict:
any file that is not exactly the documented format stops the load with a list of problems naming the
file, row and column. Nothing is guessed, and nothing is silently dropped or fixed.

What it writes (the same shape generate.py writes for the simulated estate):
    inventory.json   one dict per resource
    metrics.npz      VM x 5-minute arrays for cpu, mem, disk, iops, net_in, net_out (NaN = no reading)
    dataset.json     the data window, price list and rates; config.py reads it and replaces its defaults

Resampling to the engine's 5-minute grid (slot = floor((timestamp - window start) / 5 min)):
    readings finer than 5 min   CPU % and memory % keep the HIGHEST reading in each slot (so a 1-minute
                                spike still reaches the peak checks); disk %, IOPS and network keep the mean
    readings coarser than 5 min each reading is carried forward over the slots it covers (15 min -> 3 slots)

Deliberately imports nothing from config.py: config reads dataset.json when it is imported, so the loader
must run first.
"""
from __future__ import annotations

import io
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

STEP_MIN = 5                     # the engine's grid
MIN_DAYS = 7                     # below this nothing useful can be said
MAX_DAYS = 90
MIN_INTERVAL_MIN = 1
MAX_INTERVAL_MIN = 60            # 16-60 min is accepted, but the engine then refuses to shrink VMs (peaks can hide)
MAX_ERRORS_PER_CHECK = 5         # rows listed per problem; the total count is always given
TZ = "Asia/Kolkata"              # timestamps without an offset are read as IST

ENVS = ("prod", "staging", "dev")
TYPES = ("vm", "volume", "ip")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")

FILES = {
    "inventory": {"required": ["id", "name", "type", "region", "env", "team", "created_at", "plan", "vcpu",
                               "ram_gb", "disk_gb", "attached_to", "detached_since"], "optional": []},
    "metrics": {"required": ["timestamp", "vm_id", "cpu_pct", "mem_pct", "disk_pct", "iops", "net_in_mbps",
                             "net_out_mbps"], "optional": ["vm_name"]},
    "pricing": {"required": ["plan", "vcpu", "ram_gb"], "optional": ["price_inr_month", "price_inr_hour"]},
    "rates": {"required": ["name", "value"], "optional": []},
}
REQUIRED_FILES = ("inventory", "metrics", "pricing")
METRIC_COLS = {"cpu": "cpu_pct", "mem": "mem_pct", "disk": "disk_pct", "iops": "iops",
               "net_in": "net_in_mbps", "net_out": "net_out_mbps"}
PEAK_METRICS = ("cpu", "mem")    # max per 5-min slot; the rest use the mean
HOURS_PER_MONTH = 730
RATES = {   # name -> (default, what it is). Defaults are the illustrative ones in config.py.
    "block_inr_per_gb_month": (6.0, "block storage, ₹ per GB per month"),
    "snapshot_inr_per_gb_month": (2.0, "snapshot storage, ₹ per GB per month"),
    "public_ip_inr_per_month": (300.0, "public IP, ₹ per month"),
    "egress_inr_per_gb": (0.80, "outbound traffic, ₹ per GB"),
    "monthly_budget_inr": (850000.0, "this month's cloud budget, ₹"),
}


class CSVError(Exception):
    """The files are not in the documented format. `problems` is a list of {file, row, column, message}."""

    def __init__(self, problems: list[dict]):
        self.problems = problems
        super().__init__(f"{len(problems)} problem(s) in the uploaded files")

    def text(self) -> str:
        lines = ["Wrong file(s): the data was NOT loaded. Please fix these and upload correct files:"]
        for p in self.problems:
            where = p["file"] + (f", row {p['row']}" if p.get("row") else "") + (f", column '{p['column']}'" if p.get("column") else "")
            lines.append(f"  ✗ {where}: {p['message']}")
        lines.append("The format is described in DATA_FORMAT.md (and on the website's Upload real data page).")
        return "\n".join(lines)


class Problems:
    def __init__(self):
        self.items: list[dict] = []

    def add(self, file, message, row=None, column=None):
        self.items.append({"file": file, "row": row, "column": column, "message": message})

    def rows(self, file, column, mask: pd.Series | np.ndarray, message: str, values=None):
        """One problem per offending row (first few), plus a count. Row numbers are spreadsheet lines (header = 1)."""
        idx = np.flatnonzero(np.asarray(mask))
        if not idx.size:
            return
        for i in idx[:MAX_ERRORS_PER_CHECK]:
            v = f" (found '{values.iloc[i]}')" if values is not None else ""
            self.add(file, message + v, row=int(i) + 2, column=column)
        if idx.size > MAX_ERRORS_PER_CHECK:
            self.add(file, f"... and {idx.size - MAX_ERRORS_PER_CHECK:,} more row(s) with the same problem", column=column)

    def raise_if_any(self):
        if self.items:   # grouped by file, then in row order (file-level problems first)
            order = {f"{k}.csv": i for i, k in enumerate(FILES)}
            raise CSVError(sorted(self.items, key=lambda x: (order.get(x["file"], -1), x.get("row") or 0)))


# ----------------------------------------------------------------------------- reading one file

def sniff(file: str, raw: bytes, p: Problems) -> str | None:
    """Rejects anything that is not a plain-text, comma-separated file before pandas sees it."""
    if not raw.strip():
        p.add(file, "the file is empty")
        return None
    head = raw[:8]
    kinds = {b"PK\x03\x04": "an Excel workbook or zip archive (save it as 'CSV UTF-8' instead)",
             b"%PDF": "a PDF document", b"\xd0\xcf\x11\xe0": "an old Excel .xls file (save it as 'CSV UTF-8' instead)",
             b"\x89PNG": "a PNG image", b"\xff\xd8\xff": "a JPEG image", b"{": "JSON, not CSV", b"[": "JSON, not CSV",
             b"<": "HTML or XML, not CSV"}
    for magic, what in kinds.items():
        if head.lstrip()[:len(magic)] == magic:
            p.add(file, f"this is not a CSV file: it looks like {what}")
            return None
    if b"\x00" in raw[:65536]:
        p.add(file, "this is not a CSV file: it contains binary data (or is saved as UTF-16; save it as 'CSV UTF-8')")
        return None
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        p.add(file, f"the file is not UTF-8 text (bad byte at position {e.start}); save it as 'CSV UTF-8'")
        return None
    first = text.split("\n", 1)[0]
    if "," not in first:
        sep = next((name for ch, name in ((";", "semicolons"), ("\t", "tabs"), ("|", "pipes")) if ch in first), None)
        if sep:
            p.add(file, f"columns are separated by {sep}; they must be separated by commas", row=1)
        else:
            p.add(file, f"the first line must be the comma-separated column names, found '{first[:80]}'", row=1)
        return None
    return text


def read(file: str, kind: str, raw: bytes, p: Problems) -> pd.DataFrame | None:
    text = sniff(file, raw, p)
    if text is None:
        return None
    spec = FILES[kind]
    header = [h.strip() for h in text.split("\n", 1)[0].rstrip("\r").split(",")]
    allowed = spec["required"] + spec["optional"]
    dupes = sorted({h for h in header if header.count(h) > 1})
    missing = [c for c in spec["required"] if c not in header]
    unknown = [h for h in header if h not in allowed]
    if dupes:
        p.add(file, f"column(s) appear more than once: {', '.join(dupes)}", row=1)
    if missing and len(missing) == len(spec["required"]):
        p.add(file, f"this does not look like the {kind} file: none of its columns are there. "
                    f"Expected columns: {', '.join(spec['required'])}", row=1)
        return None
    if missing:
        p.add(file, f"missing column(s): {', '.join(missing)}. Expected: {', '.join(spec['required'])}"
                    + (f" (+ optional {', '.join(spec['optional'])})" if spec["optional"] else ""), row=1)
    if unknown:
        p.add(file, f"unexpected column(s): {', '.join(unknown)}. Only these are allowed: {', '.join(allowed)}", row=1)
    if dupes or missing or unknown:
        return None
    try:
        text_cols = {"timestamp": str, "vm_id": str, "vm_name": str}
        df = pd.read_csv(io.StringIO(text), dtype=text_cols if kind == "metrics" else str, keep_default_na=False,
                         na_values={c: [""] for c in METRIC_COLS.values()} if kind == "metrics" else None,
                         skipinitialspace=True, low_memory=False)
    except pd.errors.ParserError as e:
        m = re.search(r"line (\d+), saw (\d+)", str(e))
        if m:
            p.add(file, f"this row has {m.group(2)} values but the header has {len(header)} columns", row=int(m.group(1)))
        else:
            p.add(file, f"the file cannot be read as CSV: {e}")
        return None
    df.columns = [c.strip() for c in df.columns]
    if df.empty:
        p.add(file, "the file has a header but no data rows")
        return None
    return df


# ----------------------------------------------------------------------------- column checks

def text_col(df, file, col, p, *, required=True, allowed=None, pattern=None):
    s = df[col].astype(str).str.strip()
    if required:
        p.rows(file, col, s == "", "value is empty")
    if allowed is not None:
        bad = (s != "") & ~s.isin(allowed)
        p.rows(file, col, bad, f"must be one of {', '.join(allowed)}", s)
    if pattern is not None:
        bad = (s != "") & ~s.str.match(pattern)
        p.rows(file, col, bad, "must be 1-64 letters, digits or . _ : - (no spaces)", s)
    return s


def num_col(df, file, col, p, *, lo=None, hi=None, integer=False, empty_ok=None):
    """Numbers only. `empty_ok` = mask of rows where an empty cell is allowed (it then reads as NaN)."""
    s = df[col]
    if pd.api.types.is_numeric_dtype(s):          # pandas already read every cell as a number
        raw, v, empty = s, s.astype(float), s.isna()
    else:                                         # text: find the cells that are not numbers
        raw = s.astype(str).str.strip()
        empty = raw.isin(["", "nan", "NaN"])
        v = pd.to_numeric(raw.where(~empty, None), errors="coerce").astype(float)
        p.rows(file, col, (~empty) & v.isna(), "not a number", raw)
    need = ~empty_ok if empty_ok is not None else pd.Series(True, index=df.index)
    p.rows(file, col, empty & need, "value is empty")
    p.rows(file, col, np.isinf(v), "not a finite number", raw)
    ok = v.notna() & ~np.isinf(v)
    if lo is not None:
        p.rows(file, col, ok & (v < lo), f"must be at least {lo}", raw)
    if hi is not None:
        p.rows(file, col, ok & (v > hi), f"must be at most {hi}", raw)
    if integer:
        p.rows(file, col, ok & (v != np.floor(v)), "must be a whole number", raw)
    return v


TZ_SUFFIX = r"(?:Z|[+-]\d\d:?\d\d)$"


def time_col(df, file, col, p, *, empty_ok=None) -> pd.Series:
    """ISO dates/times. Without an offset they are IST; with one (+05:30, Z, ...) they are converted to IST."""
    raw = df[col].astype(str).str.strip()
    empty = raw == ""
    need = ~empty_ok if empty_ok is not None else pd.Series(True, index=df.index)
    p.rows(file, col, empty & need, "value is empty")
    aware = raw.str.contains(TZ_SUFFIX, regex=True) & ~empty
    if aware.any() and (~aware & ~empty).any():
        first = int(np.flatnonzero((~aware & ~empty).to_numpy())[0]) if aware.iloc[0] else int(np.flatnonzero(aware.to_numpy())[0])
        p.add(file, "some times have a timezone offset and some do not; use one style for the whole column",
              row=first + 2, column=col)
        return pd.Series(pd.NaT, index=df.index, dtype=f"datetime64[ns, {TZ}]")
    vals = raw.where(~empty, None)
    if aware.any():
        t = pd.to_datetime(vals, errors="coerce", format="ISO8601", utc=True).dt.tz_convert(TZ)
    else:
        t = pd.to_datetime(vals, errors="coerce", format="ISO8601").dt.tz_localize(TZ)
    p.rows(file, col, (~empty) & t.isna(), "not a date/time; use ISO format like 2026-09-24 or 2026-09-24 10:05", raw)
    return t


# ----------------------------------------------------------------------------- the three files

def check_pricing(df: pd.DataFrame, p: Problems) -> dict:
    f = "pricing.csv"
    has_m, has_h = "price_inr_month" in df, "price_inr_hour" in df
    if has_m == has_h:
        p.add(f, "give exactly one price column: price_inr_month OR price_inr_hour", row=1)
        return {}
    plan = text_col(df, f, "plan", p, pattern=ID_RE)
    p.rows(f, "plan", plan.duplicated(keep="first") & (plan != ""), "this plan is listed twice", plan)
    vcpu = num_col(df, f, "vcpu", p, lo=1, hi=1024, integer=True)
    ram = num_col(df, f, "ram_gb", p, lo=0.5, hi=16384)
    price = num_col(df, f, "price_inr_month" if has_m else "price_inr_hour", p, lo=0.01)
    if not has_m:
        price = price * HOURS_PER_MONTH
    return {pl: (int(v), float(m), round(float(pr), 2)) for pl, v, m, pr in zip(plan, vcpu, ram, price)
            if pl and not (np.isnan(v) or np.isnan(m) or np.isnan(pr))}


def check_rates(df: pd.DataFrame | None, p: Problems) -> tuple[dict, list[str]]:
    rates = {k: v for k, (v, _) in RATES.items()}
    notes = []
    if df is None:
        return rates, ["rates.csv not given: storage, IP, egress prices and the budget use the illustrative defaults"]
    f = "rates.csv"
    name = text_col(df, f, "name", p, allowed=list(RATES))
    p.rows(f, "name", name.duplicated() & (name != ""), "this rate is listed twice", name)
    value = num_col(df, f, "value", p, lo=0)
    for n, v in zip(name, value):
        if n in rates and not np.isnan(v):
            rates[n] = float(v)
    left = [n for n in RATES if n not in set(name)]
    if left:
        notes.append(f"rates.csv does not set {', '.join(left)}: illustrative default(s) used")
    return rates, notes


def check_inventory(df: pd.DataFrame, plans: dict, p: Problems) -> pd.DataFrame:
    f = "inventory.csv"
    out = pd.DataFrame(index=df.index)
    out["id"] = text_col(df, f, "id", p, pattern=ID_RE)
    p.rows(f, "id", out["id"].duplicated() & (out["id"] != ""), "this id is used twice", out["id"])
    for c in ("name", "region", "team"):
        out[c] = text_col(df, f, c, p)
    out["type"] = text_col(df, f, "type", p, allowed=TYPES)
    out["env"] = text_col(df, f, "env", p, allowed=ENVS)
    out["created_at"] = time_col(df, f, "created_at", p)
    vm = out["type"] == "vm"
    plan = df["plan"].astype(str).str.strip()
    p.rows(f, "plan", vm & (plan == ""), "a VM needs a plan")
    p.rows(f, "plan", vm & (plan != "") & ~plan.isin(list(plans)), "plan is not in pricing.csv", plan)
    p.rows(f, "plan", ~vm & (plan != ""), "only VMs have a plan; leave it empty for volumes and IPs", plan)
    out["plan"] = plan.where(vm, None)
    vcpu = num_col(df, f, "vcpu", p, lo=0, integer=True, empty_ok=~vm)
    ram = num_col(df, f, "ram_gb", p, lo=0, empty_ok=~vm)
    disk = num_col(df, f, "disk_gb", p, lo=0, integer=True, empty_ok=out["type"] == "ip")
    known = vm & plan.isin(list(plans))
    pv = plan.map(lambda x: plans.get(x, (np.nan, np.nan, 0))[0])
    pr = plan.map(lambda x: plans.get(x, (np.nan, np.nan, 0))[1])
    p.rows(f, "vcpu", known & vcpu.notna() & (vcpu != pv), "does not match the plan's vCPU in pricing.csv", df["vcpu"])
    p.rows(f, "ram_gb", known & ram.notna() & (ram != pr), "does not match the plan's RAM in pricing.csv", df["ram_gb"])
    p.rows(f, "vcpu", ~vm & vcpu.fillna(0).ne(0), "only VMs have vCPUs; leave it empty or 0", df["vcpu"])
    p.rows(f, "ram_gb", ~vm & ram.fillna(0).ne(0), "only VMs have RAM; leave it empty or 0", df["ram_gb"])
    p.rows(f, "disk_gb", (out["type"] == "volume") & disk.notna() & (disk < 1), "a volume needs a size of at least 1 GB", df["disk_gb"])
    p.rows(f, "disk_gb", (out["type"] == "ip") & disk.fillna(0).ne(0), "an IP has no disk; leave it empty or 0", df["disk_gb"])
    out["vcpu"] = vcpu.fillna(0).astype(int)
    out["ram_gb"] = ram.fillna(0)
    out["disk_gb"] = disk.fillna(0).astype(int)

    att = df["attached_to"].astype(str).str.strip()
    ids = set(out["id"])
    vm_ids = set(out["id"][vm])
    p.rows(f, "attached_to", vm & (att != ""), "a VM is not attached to anything; leave it empty", att)
    p.rows(f, "attached_to", ~vm & (att != "") & ~att.isin(list(ids)), "this id is not in inventory.csv", att)
    p.rows(f, "attached_to", ~vm & (att != "") & att.isin(list(ids)) & ~att.isin(list(vm_ids)), "must be the id of a VM", att)
    out["attached_to"] = att.where(att != "", None)
    unattached = ~vm & (att == "")
    det_raw = df["detached_since"].astype(str).str.strip()
    p.rows(f, "detached_since", (vm | (att != "")) & (det_raw != ""), "only unattached volumes/IPs have detached_since; leave it empty", det_raw)
    out["detached_since"] = time_col(df, f, "detached_since", p, empty_ok=~unattached)
    p.rows(f, "detached_since", out["detached_since"].notna() & out["created_at"].notna()
           & (out["detached_since"] < out["created_at"]), "is before created_at", det_raw)
    if not vm.any() and not p.items:
        p.add(f, "there are no VMs (type = vm) in the inventory")
    return out


def check_metrics(df: pd.DataFrame, inv: pd.DataFrame, p: Problems):
    f = "metrics.csv"
    vm_id = df["vm_id"].astype(str).str.strip()
    p.rows(f, "vm_id", vm_id == "", "value is empty")
    types = dict(zip(inv["id"], inv["type"]))
    unknown = (vm_id != "") & ~vm_id.isin(list(types))
    p.rows(f, "vm_id", unknown, "this id is not in inventory.csv", vm_id)
    not_vm = (vm_id != "") & vm_id.isin([k for k, t in types.items() if t != "vm"])
    p.rows(f, "vm_id", not_vm, "metrics are only for VMs; this id is a volume or IP", vm_id)
    if "vm_name" in df:
        names = dict(zip(inv["id"], inv["name"]))
        nm = df["vm_name"].astype(str).str.strip()
        p.rows(f, "vm_name", vm_id.isin(list(names)) & (nm != vm_id.map(names)), "does not match the VM's name in inventory.csv", nm)

    t = time_col(df, f, "timestamp", p)
    vals = {}
    for m, col in METRIC_COLS.items():
        hi = 100 if m in ("cpu", "mem", "disk") else None
        vals[m] = num_col(df, f, col, p, lo=0, hi=hi)
    # unit checks: catch fractions given as percent, bytes or bits given as MB/s
    for m in ("cpu", "mem"):
        v = vals[m]
        if v.notna().sum() > 100 and v.max() <= 1.0:
            p.add(f, f"every value is between 0 and 1: these look like fractions. Give percentages 0-100 (e.g. 0.42 → 42)",
                  column=METRIC_COLS[m])
    for m in ("net_in", "net_out"):
        p.rows(f, METRIC_COLS[m], vals[m] > 12500, "above 12,500 MB/s (100 Gbit/s): the unit must be megabytes per second, "
                                                   "not bytes or bits", df[METRIC_COLS[m]])
    p.rows(f, "iops", vals["iops"] > 2_000_000, "above 2,000,000 IOPS: check the unit (operations per second)", df["iops"])

    key = pd.DataFrame({"vm": vm_id, "t": t})
    dup = key.duplicated(keep="first")
    p.rows(f, "timestamp", dup, "this VM already has a reading at this time (duplicate row)", df["timestamp"])
    missing_vms = sorted(set(inv["id"][inv["type"] == "vm"]) - set(vm_id))
    for v in missing_vms[:MAX_ERRORS_PER_CHECK]:
        p.add(f, f"VM '{v}' is in inventory.csv but has no rows in metrics.csv")
    if len(missing_vms) > MAX_ERRORS_PER_CHECK:
        p.add(f, f"... and {len(missing_vms) - MAX_ERRORS_PER_CHECK} more VM(s) without metrics")
    created = dict(zip(inv["id"], inv["created_at"].dt.normalize()))
    early = t.dt.normalize() < vm_id.map(created)
    p.rows(f, "timestamp", early.fillna(False), "is before the VM's created_at date in inventory.csv", df["timestamp"])
    p.raise_if_any()
    return vm_id, t, vals


def intervals(vm_id: pd.Series, t: pd.Series, p: Problems) -> dict[str, float]:
    """Typical gap between readings per VM, in minutes (median of consecutive differences)."""
    order = pd.DataFrame({"vm": vm_id.values, "t": t.values}).sort_values(["vm", "t"])
    d = order.groupby("vm")["t"].diff().dt.total_seconds() / 60
    med = d.groupby(order["vm"]).median()
    out = {}
    for vm, m in med.items():
        if np.isnan(m):
            p.add("metrics.csv", f"VM '{vm}' has only one reading", column="timestamp")
        elif m < MIN_INTERVAL_MIN - 1e-9:
            p.add("metrics.csv", f"VM '{vm}' has readings every {m * 60:.0f} seconds; the finest accepted is every "
                                 f"{MIN_INTERVAL_MIN} minute", column="timestamp")
        elif m > MAX_INTERVAL_MIN + 1e-9:
            p.add("metrics.csv", f"VM '{vm}' has readings every {m:.0f} minutes; the coarsest accepted is every "
                                 f"{MAX_INTERVAL_MIN} minutes (5-15 is recommended)", column="timestamp")
        else:
            out[vm] = round(float(m), 2)
    return out


# ----------------------------------------------------------------------------- resampling

def resample(ids, vm_id, t, vals, step_by_vm, start, n_points) -> dict[str, np.ndarray]:
    slot = ((t - start).dt.total_seconds() // (STEP_MIN * 60)).astype(np.int64).to_numpy()
    row = vm_id.map({v: i for i, v in enumerate(ids)}).to_numpy()
    arrays = {}
    for m in METRIC_COLS:
        frame = pd.DataFrame({"r": row, "s": slot, "v": vals[m].to_numpy(dtype=float)})
        g = frame.groupby(["r", "s"])["v"]
        agg = g.max() if m in PEAK_METRICS else g.mean()
        a = np.full((len(ids), n_points), np.nan)
        a[agg.index.get_level_values(0), agg.index.get_level_values(1)] = agg.to_numpy()
        arrays[m] = a
    # coarser than the grid: a reading covers the slots up to the next one
    for i, v in enumerate(ids):
        k = int(round(step_by_vm[v] / STEP_MIN)) - 1
        if k > 0:
            for m in METRIC_COLS:
                arrays[m][i] = pd.Series(arrays[m][i]).ffill(limit=k).to_numpy()
    return arrays


# ----------------------------------------------------------------------------- the whole load

def load(files: dict[str, bytes], name: str = "Uploaded data", earlier: list[dict] | None = None) -> tuple[list[dict], dict, dict]:
    """files: {"inventory": bytes, "metrics": bytes, "pricing": bytes, "rates": bytes (optional)}.

    Returns (inventory, arrays, dataset) or raises CSVError with every problem found (plus `earlier` ones,
    e.g. a wrong file type in the folder).
    """
    p = Problems()
    p.items += earlier or []
    unknown = [k for k in files if k not in FILES]
    for k in unknown:
        p.add(f"{k}.csv", "not one of the expected files (inventory, metrics, pricing, rates)")
    for k in REQUIRED_FILES:
        if k not in files and not any(x["file"].lower().startswith(k + ".") for x in p.items):
            p.add(f"{k}.csv", "this file is required but was not provided")

    frames = {k: read(f"{k}.csv", k, raw, p) for k, raw in files.items() if k in FILES}
    p.raise_if_any()

    plans = check_pricing(frames["pricing"], p)
    rates, notes = check_rates(frames.get("rates"), p)
    p.raise_if_any()
    inv = check_inventory(frames["inventory"], plans, p)
    p.raise_if_any()
    vm_id, t, vals = check_metrics(frames["metrics"], inv, p)
    step_by_vm = intervals(vm_id, t, p)
    p.raise_if_any()

    start = t.min().normalize()
    last_slot = (t.max() - start) // pd.Timedelta(minutes=STEP_MIN)          # the 5-minute slot of the last reading
    days = int(math.ceil((last_slot + 1) / (24 * 60 // STEP_MIN)))
    span_days = (t.max() - t.min()) / pd.Timedelta(days=1)
    if span_days < MIN_DAYS - 1e-9:
        p.add("metrics.csv", f"the readings cover only {span_days:.1f} days; at least {MIN_DAYS} days are needed "
                             f"(30 or more recommended)", column="timestamp")
    if days > MAX_DAYS:
        p.add("metrics.csv", f"the readings cover {days} days; at most {MAX_DAYS} days can be loaded. "
                             f"Upload the most recent {MAX_DAYS} days", column="timestamp")
    p.raise_if_any()

    ids = list(inv["id"][inv["type"] == "vm"])
    n_points = days * 24 * 60 // STEP_MIN
    arrays = resample(ids, vm_id, t, vals, step_by_vm, start, n_points)
    inv_end = start + pd.Timedelta(days=days)
    for col in ("created_at", "detached_since"):
        late = inv[col].notna() & (inv[col] > inv_end)
        for i in np.flatnonzero(late.to_numpy())[:MAX_ERRORS_PER_CHECK]:
            p.add("inventory.csv", f"is after the last metrics reading ({inv_end.date()}); dates cannot be in the future",
                  row=int(i) + 2, column=col)
    p.raise_if_any()

    steps = sorted(set(step_by_vm.values()))
    coarse = [v for v, s in step_by_vm.items() if s > 15]
    if days < 30:
        notes.append(f"{days} days of data, below the recommended 30: confidence is lowered and risk raised one step")
    if coarse:
        notes.append(f"{len(coarse)} VM(s) report less often than every 15 minutes: short peaks can hide between readings, "
                     f"so the engine will not shrink them")
    if min(steps) < STEP_MIN:
        notes.append(f"readings every {min(steps):g} min were combined into 5-minute steps, keeping the highest CPU and memory reading")

    def opt(x):   # empty cell -> None (pandas may hand back NaN or NA)
        return x if isinstance(x, str) and x else None

    resources = []
    for r in inv.itertuples(index=False):
        resources.append({
            "id": r.id, "name": r.name, "type": r.type, "region": r.region, "env": r.env, "team": r.team,
            "created_at": r.created_at.isoformat(), "plan": opt(r.plan) if r.type == "vm" else None,
            "vcpu": int(r.vcpu), "ram_gb": int(r.ram_gb) if float(r.ram_gb).is_integer() else float(r.ram_gb),
            "disk_gb": int(r.disk_gb), "attached_to": opt(r.attached_to),
            "detached_since": r.detached_since.isoformat() if pd.notna(r.detached_since) else None,
            "persona": None, "notes": "", "tags": {}})
    dataset = {
        "source": "csv", "name": name, "start": start.isoformat(), "days": days,
        "input_step_min": {v: step_by_vm[v] for v in ids}, "coarse_vms": coarse,
        "plans": {k: list(v) for k, v in sorted(plans.items(), key=lambda kv: (kv[1][2], kv[1][0]))},
        "rates": rates, "notes": notes,
        "rows": int(len(vm_id)), "n_vms": len(ids), "n_resources": len(resources),
    }
    return resources, arrays, dataset


def write(out_dir: Path, resources, arrays, dataset) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ids = [r["id"] for r in resources if r["type"] == "vm"]
    np.savez_compressed(out_dir / "metrics.npz", ids=np.array(ids), **{m: a.astype(np.float32) for m, a in arrays.items()})
    (out_dir / "inventory.json").write_text(json.dumps(resources, indent=1, ensure_ascii=False))
    (out_dir / "dataset.json").write_text(json.dumps(dataset, indent=1, ensure_ascii=False))
    return out_dir


def read_folder(folder: Path) -> tuple[dict[str, bytes], list[dict]]:
    """Exactly inventory.csv, metrics.csv, pricing.csv and optionally rates.csv. Anything else is a problem,
    returned (not raised) so load() can report it together with what is wrong inside the other files."""
    p = Problems()
    if not folder.is_dir():
        p.add(str(folder), "this folder does not exist")
        p.raise_if_any()
    files = {}
    for f in sorted(folder.iterdir()):
        if f.name.startswith(".") or f.is_dir():
            continue
        stem, ext = f.stem.lower(), f.suffix.lower()
        if stem in FILES and ext == ".csv":
            files[stem] = f.read_bytes()
        elif stem in FILES:
            p.add(f.name, f"must be a .csv file (found {ext or 'no extension'}). Save it as 'CSV UTF-8' and name it {stem}.csv")
        else:
            p.add(f.name, "unexpected file. The folder may only hold inventory.csv, metrics.csv, pricing.csv and rates.csv")
    return files, p.items


def cli(folder: str, out_dir: Path) -> Path:
    try:
        files, problems = read_folder(Path(folder))
        resources, arrays, dataset = load(files, name=Path(folder).resolve().name, earlier=problems)
    except CSVError as e:
        print(e.text(), file=sys.stderr)
        sys.exit(1)
    write(out_dir, resources, arrays, dataset)
    print(f"✓ Loaded {dataset['n_resources']} resources ({dataset['n_vms']} VMs), {dataset['rows']:,} metric rows, "
          f"{dataset['days']} days from {dataset['start'][:10]}")
    for n in dataset["notes"]:
        print(f"  note: {n}")
    return out_dir
