/**
 * Client-side mirror of the parts of the Python engine the UI recomputes live:
 * accept/reject totals, the what-if simulator and the headroom slider.
 * Formulas are identical to engine/recommend.py and engine/config.py.
 */
import type { Assumptions, Recommendation, Resource, Risk } from "./types";

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

export function sizeFor(a: Assumptions, vcpu: number, ram: number, cpuP: number, memP: number, targetCpu: number, cpuMax?: number, memMax?: number) {
  let reqVcpu = (vcpu * (cpuP / 100)) / targetCpu;
  // the busiest single reading must also fit under the ceiling (same as recommend.py)
  if (cpuMax !== undefined) reqVcpu = Math.max(reqVcpu, (vcpu * (cpuMax / 100)) / a.MAX_CPU_CEILING);
  const used = (ram * memP) / 100;
  let reqRam = Math.max((ram * (memP / 100)) / a.TARGET_MEM_UTIL, used + a.MIN_MEM_MARGIN_GB);
  if (memMax !== undefined) reqRam = Math.max(reqRam, (ram * (memMax / 100)) / a.MAX_MEM_CEILING);
  return { reqVcpu, reqRam, plan: pickPlan(a.PLANS, reqVcpu, reqRam) };
}

export function carbon(a: Assumptions, vcpu: number) {
  const kwh = (vcpu * a.WATTS_PER_VCPU * a.HOURS_PER_MONTH * a.PUE) / 1000;
  return { kwh, kg: kwh * a.GRID_KG_CO2_PER_KWH };
}

export function totals(resources: Resource[], recs: Recommendation[], accepted: Record<string, boolean>) {
  const before = resources.reduce((s, r) => s + r.cost.total, 0);
  // a schedule is priced on the resized VM; if that resize is rejected, it runs on the bigger size and saves more
  const resized = new Set(recs.filter((r) => r.action === "resize" && accepted[r.id]).map((r) => r.resource_id));
  const acc = recs.filter((r) => accepted[r.id]).map((r) =>
    r.action === "schedule" && r.saving_alone !== undefined && !resized.has(r.resource_id) ? { ...r, saving: r.saving_alone } : r);
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
    const { plan } = sizeFor(a, r.vcpu, r.ram_gb, r.stats.cpu_p99, r.stats.mem_p99, targetCpu, r.stats.cpu_max, r.stats.mem_max);
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

/* ---------------- Hit my target (mirror of engine/target.py) ---------------- */

const LEVELS: Risk[] = ["LOW", "MEDIUM", "HIGH"];
const RANK: Record<Risk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const ELIGIBLE = new Set(["resize", "schedule", "stop", "delete_volume", "release_ip"]); // keep / review / investigate never
const STEP_INR = 100;

interface Option { recs: Recommendation[]; saving: number; risk: Risk; score: number }
type Key = [number, number, number, number]; // high count, medium count, risk score ×1000, changes

/** Per resource, the ways to act on it: each card alone, plus resize + schedule together. */
function targetOptions(recs: Recommendation[], maxRisk: Risk, excluded: Set<string>): Option[][] {
  const byRes = new Map<string, Recommendation[]>();
  for (const r of recs) {
    if (ELIGIBLE.has(r.action) && r.saving > 0 && !excluded.has(r.id) && RANK[r.risk] <= RANK[maxRisk]) {
      byRes.set(r.resource_id, [...(byRes.get(r.resource_id) ?? []), r]);
    }
  }
  return [...byRes.keys()].sort().map((id) => {
    const rs = byRes.get(id)!;
    const opts: Option[] = rs.map((r) => ({
      recs: [r], saving: r.action === "schedule" ? (r.saving_alone ?? r.saving) : r.saving, risk: r.risk, score: r.risk_score,
    }));
    const resize = rs.find((r) => r.action === "resize");
    const sched = rs.find((r) => r.action === "schedule");
    if (resize && sched) {
      opts.push({ recs: [resize, sched], saving: resize.saving + sched.saving,
        risk: RANK[resize.risk] >= RANK[sched.risk] ? resize.risk : sched.risk, score: resize.risk_score + sched.risk_score });
    }
    return opts;
  });
}

const requiredUpsizes = (recs: Recommendation[]) => recs.filter((r) => r.action === "upsize" && r.default_accepted);
const optKey = (o: Option): Key => [o.risk === "HIGH" ? 1 : 0, o.risk === "MEDIUM" ? 1 : 0, Math.round(o.score * 1000), o.recs.length];
const less = (a: Key, sa: number, b: Key, sb: number) => {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return sa < sb;
};

/** The most each risk level can save (best option per VM), net of the required upsizes. */
export function targetTiers(recs: Recommendation[], bill: number) {
  const extra = -requiredUpsizes(recs).reduce((s, r) => s + r.saving, 0);
  return LEVELS.map((risk) => {
    const gross = targetOptions(recs, risk, new Set()).reduce((s, g) => s + Math.max(...g.map((o) => o.saving)), 0);
    return { risk, saving: gross - extra, pct: Math.round(((gross - extra) / bill) * 10000) / 100 };
  });
}

export interface PlanItem { rec: Recommendation; saving: number; phase: 1 | 2 | 3 }
export interface TargetPlan {
  pct: number; target: number; reached: boolean; saving: number; achievedPct: number; upsizeCost: number;
  planRisk: number; counts: Record<Risk, number>; items: PlanItem[]; tiers: ReturnType<typeof targetTiers>; message: string;
}

/**
 * Exact multiple-choice knapsack over savings in ₹100 steps. Ranked by: fewest HIGH, fewest MEDIUM,
 * lowest total risk score, fewest changes, least overshoot. Same rules as engine/target.py.
 */
export function planForTarget(recs: Recommendation[], bill: number, pct: number, excluded: Set<string> = new Set()): TargetPlan {
  const target = (bill * pct) / 100;
  const must = requiredUpsizes(recs);
  const extra = -must.reduce((s, r) => s + r.saving, 0);
  const need = target + extra;
  const groups = targetOptions(recs, "HIGH", excluded);
  const cap = Math.floor(groups.reduce((s, g) => s + Math.max(...g.map((o) => o.saving)), 0) / STEP_INR) + 1;

  let best: ({ k: Key; s: number } | null)[] = Array(cap + 1).fill(null);
  best[0] = { k: [0, 0, 0, 0], s: 0 };
  const choice: Int32Array[] = [];
  for (const g of groups) {
    const nxt = best.slice();
    const pick = new Int32Array(cap + 1).fill(-1); // encoded as fromState * 8 + optionIndex
    for (let s = 0; s <= cap; s++) {
      const cur = best[s];
      if (!cur) continue;
      g.forEach((o, i) => {
        const s2 = Math.min(cap, s + Math.floor(o.saving / STEP_INR));
        const ok = optKey(o);
        const k: Key = [cur.k[0] + ok[0], cur.k[1] + ok[1], cur.k[2] + ok[2], cur.k[3] + ok[3]];
        const sv = cur.s + o.saving;
        const n = nxt[s2];
        if (!n || less(k, sv, n.k, n.s)) {
          nxt[s2] = { k, s: sv };
          pick[s2] = s * 8 + i;
        }
      });
    }
    choice.push(pick);
    best = nxt;
  }

  // states are whole ₹100 steps (rounded down), so "reached" is checked on the real rupee total
  let end = -1;
  for (let s = 0; s <= cap; s++) {
    const b = best[s];
    if (b && b.s >= need && (end < 0 || less(b.k, b.s, best[end]!.k, best[end]!.s))) end = s;
  }
  const reached = end >= 0;
  if (!reached) {
    for (let s = 0; s <= cap; s++) {
      const b = best[s];
      if (b && (end < 0 || b.s > best[end]!.s || (b.s === best[end]!.s && less(b.k, b.s, best[end]!.k, best[end]!.s)))) end = s;
    }
  }
  const chosen: Option[] = [];
  for (let gi = groups.length - 1, s = end; gi >= 0; gi--) {
    const p = choice[gi][s];
    if (p === -1) continue; // this VM was left alone
    chosen.push(groups[gi][p % 8]);
    s = Math.floor(p / 8);
  }

  const items: PlanItem[] = [];
  for (const o of chosen) {
    for (const r of o.recs) {
      const phase = ["delete_volume", "release_ip", "stop"].includes(r.action) ? 1 : r.env === "prod" ? 3 : 2;
      items.push({ rec: r, saving: o.recs.length === 1 ? o.saving : r.saving, phase });
    }
  }
  for (const r of must) items.push({ rec: r, saving: r.saving, phase: 1 });
  items.sort((a, b) => a.phase - b.phase || RANK[a.rec.risk] - RANK[b.rec.risk] || b.saving - a.saving || a.rec.id.localeCompare(b.rec.id));

  const saving = items.reduce((s, i) => s + i.saving, 0);
  const gross = items.filter((i) => i.saving > 0).reduce((s, i) => s + i.saving, 0);
  const planRisk = gross ? items.filter((i) => i.saving > 0).reduce((s, i) => s + i.rec.risk_score * i.saving, 0) / gross : 0;
  const counts = { LOW: 0, MEDIUM: 0, HIGH: 0 } as Record<Risk, number>;
  items.forEach((i) => { if (i.saving > 0) counts[i.rec.risk] += 1; });
  const tiers = targetTiers(recs, bill);
  const message = !reached
    ? `A ${pct}% cut (${inrPlain(target)}) cannot be reached safely. Every safe change together saves ${inrPlain(saving)} (${((saving / bill) * 100).toFixed(1)}%); VMs whose peaks would not fit a smaller size are never touched.`
    : counts.HIGH
      ? `Reached only with ${counts.HIGH} high-risk change(s): low + medium changes top out at ${tiers[1].pct.toFixed(1)}%.`
      : counts.MEDIUM
        ? `Low-risk changes alone top out at ${tiers[0].pct.toFixed(1)}% of the bill, so the plan adds ${counts.MEDIUM} medium-risk change(s) to reach ${pct}%.`
        : `Reached with low-risk changes only (${counts.LOW} changes).`;
  return { pct, target: Math.round(target), reached, saving, achievedPct: Math.round((saving / bill) * 10000) / 100,
    upsizeCost: extra, planRisk: Math.round(planRisk * 1000) / 1000, counts, items, tiers, message };
}

const inrPlain = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
