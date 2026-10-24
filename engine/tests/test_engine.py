"""Run: python -m pytest engine/tests"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config as C  # noqa: E402
from recommend import confidence, recommend_vm, size_for  # noqa: E402
from stats import daily_trend  # noqa: E402
from forecast import holt_winters  # noqa: E402


def stats(**kw):
    base = dict(cpu_avg=10, cpu_p50=9, cpu_p95=12, cpu_p99=15, cpu_max=20, mem_avg=25, mem_p95=28, mem_p99=30,
                mem_max=32, cpu_time_above_80=0, offhours_cpu_avg=10, work_cpu_avg=10, net_p95_mbps=2,
                iops_p95=200, disk_now=50, disk_slope_per_day=0, egress_gb_30d=10, cv=0.3, days_of_data=30,
                missing_frac=0, hourly_cpu=[10] * 24, heatmap_cpu=[[10] * 24] * 7, offhours_cpu_p99=4,
                offhours_busy_hours=[])
    base.update(kw)
    return base


def vm(plan="s-8-16", env="prod"):
    v, m, _ = C.PLANS[plan]
    return dict(id="vm-x", name="test", type="vm", region="Noida", env=env, team="Search", plan=plan,
                vcpu=v, ram_gb=m, disk_gb=100)


COST = {"compute": 6000, "storage": 600, "network": 8, "ip": 0, "total": 6608}


def test_off_hours_fraction_is_108_of_168():
    assert C.off_hours_fraction() == pytest.approx(108 / 168)


def test_safe_downsize_keeps_30pct_headroom():
    req_vcpu, req_ram, plan = size_for(8, 32, 28, 35)
    assert req_vcpu == pytest.approx(3.2)
    assert plan == "s-4-16"
    assert 28 * 8 / C.PLANS[plan][0] <= 70


def test_trap_vm_low_average_high_peak_is_never_downsized():
    """The PS requirement: never shrink a VM that would fall over during its daily peak."""
    st = stats(cpu_avg=12, cpu_p50=9, cpu_p95=11, cpu_p99=85, cpu_max=88, cpu_time_above_80=2)
    recs = recommend_vm(vm("s-8-16"), st, COST)
    assert [r["action"] for r in recs] == ["keep"]
    assert recs[0]["saving"] == 0
    assert recs[0]["peak_check"]["cpu_p99_after"] > 100   # what an average-based tool would do


def test_steady_low_vm_is_resized_with_correct_saving():
    recs = recommend_vm(vm("s-8-32", env="staging"), stats(cpu_p99=28, cpu_p95=25, mem_p99=35), COST)
    r = recs[0]
    assert r["action"] == "resize" and r["target_plan"] == "s-4-16"
    assert r["saving"] == 8000 - 4000
    assert r["peak_check"]["cpu_p99_after"] == pytest.approx(56)


def test_idle_prod_is_flagged_for_review_not_stopped():
    st = stats(cpu_p95=1.5, cpu_p99=2, net_p95_mbps=0.05, iops_p95=2)
    assert recommend_vm(vm(env="prod"), st, COST)[0]["action"] == "review"
    assert recommend_vm(vm(env="dev"), st, COST)[0]["action"] == "stop"


def test_saturated_vm_is_upsized():
    r = recommend_vm(vm("s-4-8"), stats(cpu_p99=97, cpu_p95=95, cpu_avg=80, cpu_time_above_80=50), COST)[0]
    assert r["action"] == "upsize" and r["saving"] < 0


def test_schedule_saving_stacks_on_resized_price_without_double_counting():
    st = stats(cpu_p99=15, cpu_p95=13, mem_p99=30, offhours_cpu_avg=1.2, work_cpu_avg=14)
    recs = recommend_vm(vm("s-8-32", env="dev"), st, COST)
    resize, schedule = recs
    target_price = C.PLANS[resize["target_plan"]][2]
    assert schedule["saving"] == round(target_price * 108 / 168)


def test_confidence_drops_for_gaps_and_short_history():
    assert confidence(stats())[0] == 100
    assert confidence(stats(missing_frac=0.1, days_of_data=10))[0] == 50


def test_holt_winters_follows_a_flat_series():
    fc, _, _ = holt_winters([100.0] * 28, horizon=7)
    assert np.allclose(fc, 100, atol=1)


def test_short_spike_invisible_to_p99_still_blocks_downsize():
    """A ~10-minute daily spike sits above p99 (which ignores the top 1% = 14 min/day). The max check catches it."""
    st = stats(cpu_avg=10, cpu_p95=12, cpu_p99=15, cpu_max=90)
    recs = recommend_vm(vm("s-8-16"), st, COST)
    assert [r["action"] for r in recs] == ["keep"]
    assert recs[0]["peak_check"]["cpu_p99_after"] > 100
    # without the spike the same VM is resized
    assert recommend_vm(vm("s-8-16"), stats(cpu_avg=10, cpu_p95=12, cpu_p99=15, cpu_max=20), COST)[0]["action"] == "resize"


def test_resize_keeps_busiest_reading_under_ceiling():
    r = recommend_vm(vm("s-8-32", env="staging"), stats(cpu_p99=28, cpu_p95=25, cpu_max=45, mem_p99=35), COST)[0]
    assert r["action"] == "resize"
    assert r["peak_check"]["cpu_max_after"] <= C.MAX_CPU_CEILING * 100


def test_nightly_job_keeps_the_vm_on_only_for_the_job():
    """A short job at 2-3 AM barely moves the night-time average, but its hourly p95 shows it: schedule around it."""
    quiet = stats(cpu_p99=15, cpu_p95=13, offhours_cpu_avg=2.5, offhours_busy_hours=[], offhours_quiet_avg=2.5, work_cpu_avg=14)
    nightly_job = {**quiet, "offhours_busy_hours": [2, 3], "offhours_quiet_avg": 2.0}
    plain = next(r for r in recommend_vm(vm("s-8-32", env="dev"), quiet, COST) if r["action"] == "schedule")
    around = next(r for r in recommend_vm(vm("s-8-32", env="dev"), nightly_job, COST) if r["action"] == "schedule")
    assert around["keep_hours"] == [1, 2, 3]                 # job hours + 1 h warm-up
    assert around["saving"] < plain["saving"]                # 3 h x 7 nights = 21 h a week stay on
    assert around["saving"] == round(plain["saving"] * (108 - 21) / 108)


def test_vm_busy_most_of_the_night_is_not_scheduled():
    busy_nights = stats(offhours_cpu_avg=20, offhours_busy_hours=list(range(0, 8)), offhours_quiet_avg=2, work_cpu_avg=14)
    assert "schedule" not in [r["action"] for r in recommend_vm(vm("s-8-32", env="dev"), busy_nights, COST)]


def test_memory_spike_blocks_a_ram_shrink():
    """p99 memory 30% fits 8 GB, but one 85% reading on 32 GB (27 GB) must still fit under the 90% ceiling."""
    st = stats(cpu_p99=28, cpu_p95=25, mem_p99=30, mem_max=85)
    _, req_ram, _ = size_for(8, 32, 28, 30, mem_max=85)
    assert req_ram == pytest.approx(32 * 0.85 / C.MAX_MEM_CEILING)
    r = recommend_vm(vm("s-8-32", env="staging"), st, COST)[0]
    assert C.PLANS[r["target_plan"]][1] >= 32 * 0.85 / C.MAX_MEM_CEILING
    assert r["peak_check"]["mem_max_after"] <= C.MAX_MEM_CEILING * 100


def test_daily_trend_finds_a_steady_climb_and_ignores_noise():
    days = np.arange(C.N_POINTS) / C.POINTS_PER_DAY
    climb = 40 + 0.9 * days + np.random.default_rng(0).normal(0, 1, C.N_POINTS)
    noise = 40 + np.random.default_rng(1).normal(0, 8, C.N_POINTS)
    up = daily_trend(climb)
    assert up["slope"] == pytest.approx(0.9, abs=0.1) and up["r2"] > 0.9
    assert daily_trend(noise)["r2"] < C.TREND_MIN_R2
