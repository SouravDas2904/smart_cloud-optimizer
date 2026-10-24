"""Classification, safe rightsizing, savings, risk and confidence.

Rules run top to bottom and the first match wins (a non-prod VM can additionally get
an off-hours schedule on top of a resize). Every recommendation carries `maths`:
the exact formula lines with real numbers, shown in the UI under "Show the maths".
"""
from __future__ import annotations

import math

import config as C

INR = lambda x: f"₹{x:,.0f}"


def monthly_cost(r: dict, st: dict | None, ip_attached: bool) -> dict:
    compute = C.PLANS[r["plan"]][2] if r["type"] == "vm" else 0.0
    storage = r["disk_gb"] * C.BLOCK_INR_PER_GB_MONTH
    network = (st["egress_gb_30d"] * C.EGRESS_INR_PER_GB) if st else 0.0
    ip = C.PUBLIC_IP_INR_PER_MONTH if (r["type"] == "ip") else 0.0
    return {"compute": round(compute), "storage": round(storage), "network": round(network),
            "ip": round(ip), "total": round(compute + storage + network + ip)}


def pick_plan(req_vcpu: float, req_ram: float) -> str:
    fits = [p for p, (v, m, _) in C.PLANS.items() if v >= req_vcpu and m >= req_ram]
    if not fits:
        return C.PLAN_ORDER[-1]
    return min(fits, key=lambda p: (C.PLANS[p][2], C.PLANS[p][0]))


def size_for(vcpu, ram, cpu_p, mem_p, target_cpu=C.TARGET_CPU_UTIL, target_mem=C.TARGET_MEM_UTIL):
    req_vcpu = vcpu * (cpu_p / 100) / target_cpu
    used_gb = ram * mem_p / 100
    req_ram = max(ram * (mem_p / 100) / target_mem, used_gb + C.MIN_MEM_MARGIN_GB)
    return req_vcpu, req_ram, pick_plan(req_vcpu, req_ram)


def confidence(st: dict) -> tuple[int, list[str]]:
    score, notes = 100.0, []
    if st["missing_frac"] > 0:
        pen = min(30.0, st["missing_frac"] * 300)
        score -= pen
        notes.append(f"{st['missing_frac'] * 100:.0f}% of readings missing (−{pen:.0f})")
    if st["days_of_data"] < C.IDLE_MIN_DAYS:
        score -= 20
        notes.append(f"only {st['days_of_data']:.0f} days of history (−20)")
    if st["cv"] > 1.0:
        score -= 15
        notes.append(f"erratic usage, coefficient of variation {st['cv']:.1f} (−15)")
    if 0 < st["cpu_time_above_80"] < 3:
        score -= 10
        notes.append("short peaks seen: a monthly job could be outside the 30-day window (−10)")
    if not notes:
        notes.append("30 days of complete, stable data")
    return int(max(10, min(100, round(score)))), notes


def risk_level(env, p99_after, mem_after, bursty, memory_bound):
    if p99_after > 75 or mem_after > 75 or memory_bound:
        return "HIGH"
    if p99_after >= 60 or mem_after >= 60 or env == "prod" or bursty:
        return "MEDIUM"
    return "LOW"


def recommend_vm(r: dict, st: dict, cost: dict) -> list[dict]:
    recs = []
    plan, vcpu, ram, env = r["plan"], r["vcpu"], r["ram_gb"], r["env"]
    price = C.PLANS[plan][2]
    conf, conf_notes = confidence(st)
    # a short daily spike: the top 1% of readings is far above the top 5%
    bursty = st["cpu_p99"] / max(st["cpu_p95"], 1.0) > 2
    base = {"resource_id": r["id"], "resource_name": r["name"], "resource_type": "vm", "env": env,
            "region": r["region"], "team": r["team"], "current_plan": plan,
            "confidence": conf, "confidence_notes": conf_notes}

    # 1. idle
    idle = (st["cpu_p95"] < C.IDLE_CPU_P95 and st["net_p95_mbps"] < C.IDLE_NET_P95_MBPS
            and st["iops_p95"] < C.IDLE_IOPS_P95 and st["days_of_data"] >= C.IDLE_MIN_DAYS)
    if idle:
        maths = [f"p95 CPU {st['cpu_p95']:.1f}% < {C.IDLE_CPU_P95:.0f}%, p95 network {st['net_p95_mbps']:.2f} MB/s < {C.IDLE_NET_P95_MBPS} MB/s, "
                 f"p95 IOPS {st['iops_p95']:.0f} < {C.IDLE_IOPS_P95:.0f} for {st['days_of_data']:.0f} days → idle",
                 f"Saving = plan price = {INR(price)}/month (compute only)",
                 f"Disk ({r['disk_gb']} GB × ₹{C.BLOCK_INR_PER_GB_MONTH:.0f} = {INR(cost['storage'])}) is still billed while stopped"]
        if env == "prod":
            recs.append({**base, "action": "review", "title": "Idle production VM: ask the owner",
                         "reason": f"Near-zero CPU, network and disk activity for {st['days_of_data']:.0f} days. It is production, "
                                   f"so we never stop it automatically: the {r['team']} team should confirm it is unused.",
                         "target_plan": None, "saving": price, "risk": "HIGH", "maths": maths,
                         "vcpu_removed": vcpu, "peak_check": None})
        else:
            recs.append({**base, "action": "stop", "title": "Stop idle VM",
                         "reason": f"Near-zero activity for {st['days_of_data']:.0f} days in {env}. Stop it now, "
                                   f"and delete it after a snapshot if nobody objects within 7 days.",
                         "target_plan": None, "saving": price, "risk": "LOW", "maths": maths,
                         "vcpu_removed": vcpu, "peak_check": None})
        return recs

    req_vcpu, req_ram, target = size_for(vcpu, ram, st["cpu_p99"], st["mem_p99"])
    tv, tr, tprice = C.PLANS[target]
    p99_after = st["cpu_p99"] * vcpu / tv
    mem_after = st["mem_p99"] * ram / tr
    sizing_maths = [
        f"required vCPU = {vcpu} × p99 CPU {st['cpu_p99']:.1f}% ÷ {C.TARGET_CPU_UTIL:.0%} target = {req_vcpu:.2f}",
        f"required RAM = max({ram} GB × p99 mem {st['mem_p99']:.1f}% ÷ {C.TARGET_MEM_UTIL:.0%}, used + {C.MIN_MEM_MARGIN_GB:.0f} GB) = {req_ram:.1f} GB",
        f"cheapest plan with ≥ {math.ceil(req_vcpu - 1e-9)} vCPU and ≥ {req_ram:.1f} GB = {target} ({tv} vCPU / {tr} GB, {INR(tprice)}/month)",
        f"Peak Safety Check: p99 after = {st['cpu_p99']:.1f}% × {vcpu} ÷ {tv} = {p99_after:.0f}% CPU; memory p99 after = {mem_after:.0f}%",
    ]
    peak = {"cpu_p99_before": st["cpu_p99"], "cpu_p99_after": round(p99_after, 1),
            "mem_p99_before": st["mem_p99"], "mem_p99_after": round(mem_after, 1), "safe": p99_after <= 75 and mem_after <= 80}

    # 2. under-provisioned -> upsize
    if st["cpu_p99"] > C.UNDER_P99 or st["mem_p99"] > C.UNDER_P99:
        idx = C.PLAN_ORDER.index(plan)
        if tprice <= price:  # make sure we actually go up
            bigger = [p for p in C.PLAN_ORDER if C.PLANS[p][0] > vcpu and C.PLANS[p][1] >= ram]
            target = bigger[0] if bigger else C.PLAN_ORDER[min(idx + 1, len(C.PLAN_ORDER) - 1)]
            tv, tr, tprice = C.PLANS[target]
            p99_after = st["cpu_p99"] * vcpu / tv
            peak.update(cpu_p99_after=round(p99_after, 1), safe=True)
        recs.append({**base, "action": "upsize", "title": "Upsize: running out of headroom",
                     "reason": f"p99 CPU is {st['cpu_p99']:.0f}% and it spends {st['cpu_time_above_80']:.0f}% of the time above 80%. "
                               f"Users will feel slowdowns at peak. Moving to {target} brings the peak to about {p99_after:.0f}%.",
                     "target_plan": target, "saving": price - tprice, "risk": "LOW", "maths": sizing_maths + [
                         f"Extra cost = {INR(tprice)} − {INR(price)} = {INR(tprice - price)}/month (reliability, not savings)"],
                     "vcpu_removed": vcpu - tv, "peak_check": peak})
        return recs

    effective_price = price
    # 3. resize when the safe target is cheaper
    if tprice < price:
        memory_bound = st["mem_p99"] > 70
        risk = risk_level(env, p99_after, mem_after, bursty, memory_bound)
        family = " (memory-optimised family)" if target.startswith("m-") and not plan.startswith("m-") else ""
        recs.append({**base, "action": "resize", "title": f"Resize {plan} → {target}{family}",
                     "reason": f"Even at its busiest 1% of the time this VM uses only {st['cpu_p99']:.0f}% CPU and {st['mem_p99']:.0f}% memory. "
                               f"On {target} its peak would run at about {p99_after:.0f}% CPU, inside the 30% headroom rule.",
                     "target_plan": target, "saving": price - tprice, "risk": risk,
                     "maths": sizing_maths + [f"Saving = {INR(price)} − {INR(tprice)} = {INR(price - tprice)}/month"],
                     "vcpu_removed": vcpu - tv, "peak_check": peak})
        effective_price = tprice
    elif st["cpu_avg"] < 20:
        # 3b. the trap: average says shrink, peak says no -> explicit "protected" card
        _, _, avg_plan = size_for(vcpu, ram, st["cpu_avg"], st["mem_avg"])
        av = C.PLANS[avg_plan][0]
        crash = st["cpu_p99"] * vcpu / av
        peak_hour = max(range(24), key=lambda h: st["hourly_cpu"][h])
        recs.append({**base, "action": "keep", "title": "Keep size: daily peak protected",
                     "reason": f"Average CPU is only {st['cpu_avg']:.0f}%, so an average-based tool would shrink it to {avg_plan}. "
                               f"But every day around {peak_hour:02d}:00 it reaches {st['cpu_p99']:.0f}% (p99). On {avg_plan} that peak "
                               f"would need {crash:.0f}% CPU and the VM would fall over. We do not downsize it.",
                     "target_plan": plan, "saving": 0, "risk": "LOW",
                     "maths": [f"average-based: {vcpu} × {st['cpu_avg']:.1f}% ÷ 70% → {avg_plan} ({av} vCPU)",
                               f"peak on {avg_plan} = {st['cpu_p99']:.1f}% × {vcpu} ÷ {av} = {crash:.0f}% → overload",
                               sizing_maths[0], "required ≥ current size → no safe downsize"],
                     "vcpu_removed": 0,
                     "peak_check": {**peak, "cpu_p99_after": round(crash, 1), "safe": False, "avg_based_plan": avg_plan}})

    # 4. off-hours schedule for non-prod
    if env != "prod" and st["offhours_cpu_avg"] < C.OFFHOURS_CPU_MAX:
        frac = C.off_hours_fraction()
        saving = effective_price * frac
        recs.append({**base, "action": "schedule", "title": "Auto-stop nights & weekends",
                     "reason": f"Average CPU outside office hours is {st['offhours_cpu_avg']:.1f}% versus {st['work_cpu_avg']:.0f}% "
                               f"during the work day. Stop it 8 PM–8 AM on weekdays and all weekend.",
                     "target_plan": None, "saving": round(saving), "risk": "LOW" if env == "dev" else "MEDIUM",
                     "maths": [f"off window = 12 h × 5 weekdays + 48 weekend h = 108 of 168 weekly hours = {frac:.1%}",
                               f"Saving = {INR(effective_price)} {'(after resize) ' if effective_price != price else ''}× {frac:.1%} = {INR(saving)}/month",
                               "Storage keeps billing while stopped (not counted as saving)"],
                     "vcpu_removed": round(C.PLANS[recs[0]['target_plan']][0] if recs and recs[0]['action'] == 'resize' else vcpu) * frac,
                     "peak_check": None})
    return recs


def recommend_orphan(r: dict, now_iso: str) -> dict | None:
    import pandas as pd
    days = (pd.Timestamp(now_iso) - pd.Timestamp(r["detached_since"])).days
    if days < C.ORPHAN_GRACE_DAYS:
        return None
    base = {"resource_id": r["id"], "resource_name": r["name"], "env": r["env"], "region": r["region"],
            "team": r["team"], "current_plan": None, "target_plan": None, "confidence": 95,
            "confidence_notes": ["inventory fact: not attached to any resource"], "vcpu_removed": 0, "peak_check": None}
    if r["type"] == "volume":
        gross = r["disk_gb"] * C.BLOCK_INR_PER_GB_MONTH
        snap = r["disk_gb"] * C.SNAPSHOT_INR_PER_GB_MONTH
        return {**base, "resource_type": "volume", "action": "delete_volume", "title": "Snapshot & delete orphaned volume",
                "reason": f"{r['disk_gb']} GB volume not attached to any VM for {days} days. Keep a cheap snapshot as a safety net, then delete.",
                "saving": round(gross - snap), "risk": "LOW",
                "maths": [f"{r['disk_gb']} GB × ₹{C.BLOCK_INR_PER_GB_MONTH:.0f} = {INR(gross)}/month today",
                          f"snapshot {r['disk_gb']} GB × ₹{C.SNAPSHOT_INR_PER_GB_MONTH:.0f} = {INR(snap)}/month",
                          f"Saving = {INR(gross)} − {INR(snap)} = {INR(gross - snap)}/month"]}
    return {**base, "resource_type": "ip", "action": "release_ip", "title": "Release unused public IP",
            "reason": f"Reserved but not assigned to anything for {days} days.",
            "saving": round(C.PUBLIC_IP_INR_PER_MONTH), "risk": "LOW",
            "maths": [f"Saving = {INR(C.PUBLIC_IP_INR_PER_MONTH)}/month per idle IP"]}
