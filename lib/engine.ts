/**
 * Client-side mirror of the parts of the Python engine the UI recomputes live:
 * accept/reject totals, the what-if simulator and the headroom slider.
 * Formulas are identical to engine/recommend.py and engine/config.py.
 */
import type { Assumptions, Recommendation, Resource } from "./types";

export function offHoursFraction(start: number, end: number, weekends: boolean) {
  const nightly = start === end ? 0 : (24 - start + end) % 24;
  return weekends ? (nightly * 5 + 48) / 168 : (nightly * 7) / 168;
}

/** true if hour h (0-23) on weekday d (0=Mon) falls in the shutdown window */
export function inWindow(d: number, h: number, start: number, end: number, weekends: boolean) {
  if (weekends && d >= 5) return true;
  if (start === end) return false;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

export function pickPlan(plans: Assumptions["PLANS"], reqVcpu: number, reqRam: number) {
  const fits = Object.entries(plans).filter(([, [v, m]]) => v >= reqVcpu && m >= reqRam);
  if (!fits.length) return Object.keys(plans).at(-1)!;
  fits.sort((a, b) => a[1][2] - b[1][2] || a[1][0] - b[1][0]);
  return fits[0][0];
}

export function sizeFor(a: Assumptions, vcpu: number, ram: number, cpuP: number, memP: number, targetCpu: number) {
  const reqVcpu = (vcpu * (cpuP / 100)) / targetCpu;
  const used = (ram * memP) / 100;
  const reqRam = Math.max((ram * (memP / 100)) / a.TARGET_MEM_UTIL, used + a.MIN_MEM_MARGIN_GB);
  return { reqVcpu, reqRam, plan: pickPlan(a.PLANS, reqVcpu, reqRam) };
}

export function carbon(a: Assumptions, vcpu: number) {
  const kwh = (vcpu * a.WATTS_PER_VCPU * a.HOURS_PER_MONTH * a.PUE) / 1000;
  return { kwh, kg: kwh * a.GRID_KG_CO2_PER_KWH };
}

export function totals(resources: Resource[], recs: Recommendation[], accepted: Record<string, boolean>) {
  const before = resources.reduce((s, r) => s + r.cost.total, 0);
  const acc = recs.filter((r) => accepted[r.id]);
  const saving = acc.reduce((s, r) => s + r.saving, 0);
  const byEnv: Record<string, { before: number; saving: number }> = {};
  const byTeam: Record<string, { before: number; saving: number }> = {};
  for (const r of resources) {
    (byEnv[r.env] ??= { before: 0, saving: 0 }).before += r.cost.total;
    (byTeam[r.team] ??= { before: 0, saving: 0 }).before += r.cost.total;
  }
  for (const r of acc) {
    byEnv[r.env].saving += r.saving;
    byTeam[r.team].saving += r.saving;
  }
  const byAction: Record<string, number> = {};
  for (const r of acc) byAction[r.action] = (byAction[r.action] ?? 0) + r.saving;
  const vcpu = acc.reduce((s, r) => s + Math.max(0, r.vcpu_removed || 0), 0);
  return { before, saving, after: before - saving, byEnv, byTeam, byAction, vcpu, count: acc.length };
}

export interface WhatIfInput {
  envs: string[]; regions: string[]; teams: string[];
  start: number; end: number; weekends: boolean; conflictPct: number;
}

/** "Shut down every matching VM in this window": saving + VMs that would be hurt */
export function whatIfSchedule(resources: Resource[], a: Assumptions, w: WhatIfInput) {
  const frac = offHoursFraction(w.start, w.end, w.weekends);
  const vms = resources.filter(
    (r) => r.type === "vm" && w.envs.includes(r.env) && w.regions.includes(r.region) && w.teams.includes(r.team),
  );
  const rows = vms.map((r) => {
    const price = a.PLANS[r.plan!][2];
    let peakInWindow = 0;
    let busiest = "";
    r.profile?.forEach((row, d) =>
      row.forEach((v, h) => {
        if (inWindow(d, h, w.start, w.end, w.weekends) && v > peakInWindow) {
          peakInWindow = v;
          busiest = `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]} ${String(h).padStart(2, "0")}:00`;
        }
      }),
    );
    return { r, saving: price * frac, peakInWindow, busiest, conflict: peakInWindow > w.conflictPct };
  });
  const safe = rows.filter((x) => !x.conflict);
  return {
    frac,
    rows,
    saving: safe.reduce((s, x) => s + x.saving, 0),
    savingIfForced: rows.reduce((s, x) => s + x.saving, 0),
    conflicts: rows.filter((x) => x.conflict),
    vcpuHours: safe.reduce((s, x) => s + x.r.vcpu * frac, 0),
  };
}

/** Re-run the resize rule with a different headroom target (VMs eligible for sizing only). */
export function whatIfHeadroom(resources: Resource[], recs: Recommendation[], a: Assumptions, targetCpu: number) {
  const excluded = new Set(
    recs.filter((r) => ["stop", "review", "upsize", "investigate"].includes(r.action)).map((r) => r.resource_id),
  );
  let saving = 0;
  let count = 0;
  let riskyCount = 0;
  for (const r of resources) {
    if (r.type !== "vm" || !r.stats || excluded.has(r.id)) continue;
    const { plan } = sizeFor(a, r.vcpu, r.ram_gb, r.stats.cpu_p99, r.stats.mem_p99, targetCpu);
    const cur = a.PLANS[r.plan!][2];
    const tgt = a.PLANS[plan][2];
    if (tgt < cur) {
      saving += cur - tgt;
      count += 1;
      if ((r.stats.cpu_p99 * r.vcpu) / a.PLANS[plan][0] > 75) riskyCount += 1;
    }
  }
  return { saving, count, riskyCount };
}
