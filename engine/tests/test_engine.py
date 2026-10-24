"""Run: python -m pytest engine/tests"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config as C  # noqa: E402
from recommend import confidence, recommend_vm, size_for  # noqa: E402
from forecast import holt_winters  # noqa: E402


def stats(**kw):
    base = dict(cpu_avg=10, cpu_p50=9, cpu_p95=12, cpu_p99=15, cpu_max=20, mem_avg=25, mem_p95=28, mem_p99=30,
                mem_max=32, cpu_time_above_80=0, offhours_cpu_avg=10, work_cpu_avg=10, net_p95_mbps=2,
                iops_p95=200, disk_now=50, disk_slope_per_day=0, egress_gb_30d=10, cv=0.3, days_of_data=30,
                missing_frac=0, hourly_cpu=[10] * 24, heatmap_cpu=[[10] * 24] * 7)
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
