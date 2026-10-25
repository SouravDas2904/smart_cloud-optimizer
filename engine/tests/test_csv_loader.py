"""Bring your own data: the loader must accept correct files and refuse everything else with a clear reason."""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))
import csv_loader as L  # noqa: E402

PRICING = "plan,vcpu,ram_gb,price_inr_month\ns-2-4,2,4,1500\ns-4-8,4,8,3000\ns-8-16,8,16,6000\n"
INVENTORY = (
    "id,name,type,region,env,team,created_at,plan,vcpu,ram_gb,disk_gb,attached_to,detached_since\n"
    "vm-1,prod-api-01,vm,Noida,prod,Payments,2026-01-01,s-8-16,8,16,100,,\n"
    "vm-2,dev-box-01,vm,Mumbai,dev,Search,2026-01-01,s-4-8,4,8,50,,\n"
    "vm-3,prod-spiky-01,vm,Mumbai,prod,Growth,2026-01-01,s-8-16,8,16,50,,\n"
    "vol-1,old-vol-01,volume,Noida,dev,Data,2026-01-01,,,,200,,2026-08-01\n"
    "ip-1,eip-01,ip,Noida,prod,Payments,2026-01-01,,,,,vm-1,\n"
)


def metrics_csv(days=10, step=5, start="2026-09-01 00:00", spike_minutes=None) -> str:
    """3 VMs: a quiet prod API (shrinkable), an idle dev box, and a VM with one short daily CPU spike at 10:00."""
    rng = np.random.default_rng(1)
    t = pd.date_range(start, periods=days * 24 * 60 // step, freq=f"{step}min")
    hour = t.hour + t.minute / 60
    rows = []
    for vm, cpu in [("vm-1", 12 + rng.normal(0, 1, len(t))), ("vm-2", 1 + rng.normal(0, 0.1, len(t)).clip(0)),
                    ("vm-3", 8 + rng.normal(0, 1, len(t)) + np.where((hour >= 10) & (hour < 10 + (spike_minutes or 30) / 60), 80, 0))]:
        for i in range(len(t)):
            rows.append(f"{t[i]:%Y-%m-%d %H:%M},{vm},{max(cpu[i], 0):.2f},30.0,40.0,{20 if vm != 'vm-2' else 1},0.3,0.2")
    return "timestamp,vm_id,cpu_pct,mem_pct,disk_pct,iops,net_in_mbps,net_out_mbps\n" + "\n".join(rows) + "\n"


def files(**over) -> dict:
    base = {"inventory": INVENTORY.encode(), "metrics": metrics_csv().encode(), "pricing": PRICING.encode()}
    base.update({k: (v.encode() if isinstance(v, str) else v) for k, v in over.items()})
    return {k: v for k, v in base.items() if v is not None}


def problems(**over) -> list[str]:
    with pytest.raises(L.CSVError) as e:
        L.load(files(**over))
    return [f"{p['file']}|{p.get('row')}|{p.get('column')}|{p['message']}" for p in e.value.problems]


def has(msgs, *parts):
    assert any(all(x in m for x in parts) for m in msgs), msgs


# ------------------------------------------------------------------ correct files load

def test_correct_files_load():
    inv, arrays, ds = L.load(files())
    assert ds["n_vms"] == 3 and ds["days"] == 10 and ds["start"].startswith("2026-09-01T00:00:00+05:30")
    assert arrays["cpu"].shape == (3, 10 * 288)
    assert {r["id"]: r["attached_to"] for r in inv}["ip-1"] == "vm-1"
    has(ds["notes"], "below the recommended 30")


def test_one_minute_data_keeps_the_spike():
    """A 1-minute spike must survive the move to 5-minute steps (max per slot for CPU)."""
    _, arrays, ds = L.load(files(metrics=metrics_csv(step=1, spike_minutes=1)))
    assert ds["input_step_min"]["vm-3"] == 1
    assert np.nanmax(arrays["cpu"][2]) > 85            # the mean of the slot would be ~24%
    has(ds["notes"], "highest CPU and memory reading")


def test_fifteen_minute_data_fills_its_slots():
    _, arrays, ds = L.load(files(metrics=metrics_csv(step=15)))
    assert ds["input_step_min"]["vm-1"] == 15
    assert np.isnan(arrays["cpu"]).mean() < 0.01       # each reading covers 3 five-minute slots
    assert not ds["coarse_vms"]


def test_hourly_data_is_marked_coarse():
    _, _, ds = L.load(files(metrics=metrics_csv(step=60)))
    assert set(ds["coarse_vms"]) == {"vm-1", "vm-2", "vm-3"}
    has(ds["notes"], "will not shrink")


def test_timezone_offsets_are_converted_to_ist():
    m = metrics_csv().replace(" 00:00,", " 00:00+05:30,")
    lines = m.splitlines()
    m = "\n".join([lines[0]] + [l.replace(",vm-", "+05:30,vm-", 1) if "+05:30" not in l else l for l in lines[1:]]) + "\n"
    _, _, ds = L.load(files(metrics=m))
    assert ds["start"].startswith("2026-09-01T00:00:00+05:30")


# ------------------------------------------------------------------ wrong files are refused

def test_missing_file():
    has(problems(pricing=None), "pricing.csv", "required")


def test_excel_renamed_to_csv():
    has(problems(inventory=b"PK\x03\x04binary-zip-stuff"), "inventory.csv", "Excel workbook")


def test_pdf_and_binary():
    has(problems(metrics=b"%PDF-1.7 ..."), "metrics.csv", "PDF")
    has(problems(pricing=b"plan,vcpu\x00\x00"), "pricing.csv", "binary")


def test_empty_file_and_header_only():
    has(problems(pricing=""), "pricing.csv", "empty")
    has(problems(pricing="plan,vcpu,ram_gb,price_inr_month\n"), "pricing.csv", "no data rows")


def test_random_csv():
    has(problems(inventory="Name,Age,City\nAsha,31,Pune\n"), "inventory.csv", "does not look like the inventory file")


def test_semicolons():
    has(problems(pricing="plan;vcpu;ram_gb;price_inr_month\ns-2-4;2;4;1500\n"), "pricing.csv", "semicolons")


def test_missing_and_unexpected_columns():
    m = metrics_csv().replace("net_out_mbps", "net_out_bytes")
    msgs = problems(metrics=m)
    has(msgs, "metrics.csv", "missing column(s): net_out_mbps")
    has(msgs, "metrics.csv", "unexpected column(s): net_out_bytes")


def test_ragged_row():
    m = metrics_csv() + "2026-09-11 00:00,vm-1,5,5\n"
    has(problems(metrics=m.replace("2026-09-11 00:00,vm-1,5,5\n", "2026-09-11 00:00,vm-1,5,5,1,2,3,4,5\n")), "metrics.csv", "values but the header has")


def test_cpu_above_100_names_the_row():
    lines = metrics_csv().splitlines()
    parts = lines[52].split(",")
    parts[2] = "134"
    lines[52] = ",".join(parts)
    has(problems(metrics="\n".join(lines) + "\n"), "metrics.csv|53|cpu_pct|must be at most 100")


def test_fractions_instead_of_percent():
    lines = metrics_csv().splitlines()
    out = [lines[0]]
    for l in lines[1:]:
        p = l.split(",")
        p[2] = f"{float(p[2]) / 1000:.4f}"
        out.append(",".join(p))
    has(problems(metrics="\n".join(out) + "\n"), "cpu_pct", "fractions")


def test_text_in_number_column():
    lines = metrics_csv().splitlines()
    lines[5] = lines[5].replace(",30.0,", ",high,", 1)
    has(problems(metrics="\n".join(lines) + "\n"), "metrics.csv|6|mem_pct|not a number")


def test_network_in_bytes():
    lines = metrics_csv().splitlines()
    lines[9] = lines[9].rsplit(",", 1)[0] + ",250000000"
    has(problems(metrics="\n".join(lines) + "\n"), "net_out_mbps", "megabytes per second")


def test_unknown_vm_and_vm_without_metrics():
    m = metrics_csv().replace(",vm-2,", ",vm-99,")
    msgs = problems(metrics=m)
    has(msgs, "vm_id", "not in inventory.csv")


def test_vm_without_metrics():
    m = "\n".join(l for l in metrics_csv().splitlines() if ",vm-2," not in l) + "\n"
    has(problems(metrics=m), "VM 'vm-2' is in inventory.csv but has no rows")


def test_duplicate_reading():
    lines = metrics_csv().splitlines()
    has(problems(metrics="\n".join(lines + [lines[10]]) + "\n"), "duplicate row")


def test_bad_timestamp():
    lines = metrics_csv().splitlines()
    lines[3] = "yesterday" + lines[3][16:]
    has(problems(metrics="\n".join(lines) + "\n"), "metrics.csv|4|timestamp|not a date/time")


def test_mixed_timezone_styles():
    lines = metrics_csv().splitlines()
    lines[2] = lines[2].replace(",vm-1,", "+05:30,vm-1,", 1)
    has(problems(metrics="\n".join(lines) + "\n"), "timezone offset")


def test_too_few_days():
    has(problems(metrics=metrics_csv(days=3)), "only 3.0 days", "at least 7")


def test_interval_too_coarse():
    has(problems(metrics=metrics_csv(step=120)), "every 120 minutes", "coarsest accepted")


def test_inventory_rules():
    inv = INVENTORY.replace("vm-2,dev-box-01,vm,Mumbai,dev,Search,2026-01-01,s-4-8,4,8",
                            "vm-2,dev-box-01,vm,Mumbai,qa,Search,2026-01-01,s-4-9,4,8")
    msgs = problems(inventory=inv)
    has(msgs, "inventory.csv|3|env|must be one of prod, staging, dev")
    has(msgs, "inventory.csv|3|plan|plan is not in pricing.csv")


def test_inventory_vcpu_must_match_plan():
    inv = INVENTORY.replace("s-8-16,8,16,100", "s-8-16,6,16,100")
    has(problems(inventory=inv), "inventory.csv|2|vcpu|does not match the plan")


def test_orphan_needs_detached_since():
    inv = INVENTORY.replace("200,,2026-08-01", "200,,")
    has(problems(inventory=inv), "inventory.csv|5|detached_since|value is empty")


def test_pricing_needs_one_price_column():
    has(problems(pricing="plan,vcpu,ram_gb\ns-2-4,2,4\n"), "exactly one price column")


def test_rates_unknown_name():
    has(problems(rates="name,value\negress_per_tb,5\n"), "rates.csv|2|name|must be one of")


def test_folder_with_wrong_files(tmp_path):
    (tmp_path / "inventory.xlsx").write_bytes(b"PK\x03\x04")
    (tmp_path / "notes.txt").write_text("hello")
    files, earlier = L.read_folder(tmp_path)
    with pytest.raises(L.CSVError) as e:
        L.load(files, earlier=earlier)
    msgs = [p["file"] + " " + p["message"] for p in e.value.problems]
    has(msgs, "must be a .csv file")
    has(msgs, "unexpected file")
    has(msgs, "pricing.csv", "required but was not provided")
    assert not any(m.startswith("inventory.csv ") for m in msgs)   # the .xlsx already explains the missing inventory


# ------------------------------------------------------------------ the engine on uploaded data

def build(folder: Path, out: Path):
    env = {**os.environ, "SMARTCLOUD_OUT_DIR": str(out)}
    env.pop("SMARTCLOUD_DATA_DIR", None)
    r = subprocess.run([sys.executable, str(ENGINE / "build.py"), "--data", str(folder)], env=env, capture_output=True, text=True, cwd=ENGINE)
    return r


def write_folder(path: Path, **over) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    for k, v in files(**over).items():
        (path / f"{k}.csv").write_bytes(v)
    return path


def test_build_refuses_wrong_files(tmp_path):
    r = build(write_folder(tmp_path / "in", inventory="Name,Age\nA,1\n"), tmp_path / "out")
    assert r.returncode == 1
    assert "NOT loaded" in r.stderr and "does not look like the inventory file" in r.stderr
    assert not (tmp_path / "out" / "summary.json").exists()


def test_build_on_ten_days(tmp_path):
    r = build(write_folder(tmp_path / "in"), tmp_path / "out")
    assert r.returncode == 0, r.stderr
    out = tmp_path / "out"
    s = json.loads((out / "summary.json").read_text())
    f = json.loads((out / "forecast.json").read_text())
    recs = {x["resource_id"]: x for x in json.loads((out / "recommendations.json").read_text()) if x["resource_type"] == "vm"}
    assert s["window_days"] == 10 and s["data_source"]["kind"] == "csv"
    assert not f["enabled"] and "14 days" in f["disabled_reason"] and f["forecast"] == []
    assert not s["data_source"]["features"]["trend_alerts"]
    # the quiet prod VM shrinks, but with the short-history penalty: risk one step up, confidence noted
    assert recs["vm-1"]["action"] == "resize" and recs["vm-1"]["risk"] == "HIGH"
    assert any("based on 10 days" in n for n in recs["vm-1"]["confidence_notes"])
    # the spiky VM is protected by its peak even though its average is low
    assert recs["vm-3"]["action"] == "keep"


def test_build_hourly_never_shrinks(tmp_path):
    r = build(write_folder(tmp_path / "in", metrics=metrics_csv(days=30, step=60)), tmp_path / "out")
    assert r.returncode == 0, r.stderr
    recs = json.loads((tmp_path / "out" / "recommendations.json").read_text())
    assert not [x for x in recs if x["action"] == "resize"]
    assert any(x["title"].startswith("Peaks cannot be checked") for x in recs)


def test_sample_files_load():
    sample = ENGINE.parent / "public" / "samples" / "demo_company"
    inv, arrays, ds = L.load(*L.read_folder(sample)[:1])
    assert ds["days"] == 30 and ds["n_vms"] == 16 and not ds["coarse_vms"]
