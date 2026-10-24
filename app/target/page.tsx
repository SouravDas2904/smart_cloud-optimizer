"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Crosshair, ShieldAlert, ShieldCheck, Undo2, X } from "lucide-react";
import { useApp } from "../providers";
import { EnvPill, Kpi, Loading, PageTitle, RiskPill } from "@/components/ui";
import { planForTarget, type PlanItem } from "@/lib/engine";
import { ACTION_LABEL, cls, inr, inrShort } from "@/lib/format";

const KEY = "sco.target.excluded";
const PHASES = {
  1: { title: "Week 1: clean-ups and required upsizes", sub: "Orphaned volumes, unused IPs and idle dev VMs have nothing running on them. Upsizes fix VMs that are already too small." },
  2: { title: "Week 2: dev and staging", sub: "Resizes and night schedules where a mistake does not reach customers." },
  3: { title: "Week 3: production", sub: "Production resizes last, after the lower environments have run on their new sizes for a week." },
} as const;

export default function HitMyTarget() {
  const { data, setMany } = useApp();
  const [pct, setPct] = useState(15);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v) setExcluded(JSON.parse(v));
    } catch { /* private mode: start empty */ }
  }, []);
  const saveExcluded = (ids: string[]) => {
    setExcluded(ids);
    setApplied(false);
    try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* in memory only */ }
  };

  const bill = data?.summary.current_monthly ?? 0;
  const plan = useMemo(
    () => (data ? planForTarget(data.recs, bill, pct, new Set(excluded)) : null),
    [data, bill, pct, excluded],
  );
  if (!data || !plan) return <Loading />;

  const s = data.summary;
  const budgetGap = s.projected_next_month - s.budget_monthly;
  const budgetPct = Math.ceil((budgetGap / bill) * 1000) / 10;
  const [low, med, all] = plan.tiers;
  const scale = Math.max(25, Math.ceil(all.pct + 2));
  const chosenIds = new Set(plan.items.map((i) => i.rec.id));
  const optional = data.recs.filter((r) => ["resize", "schedule", "stop", "delete_volume", "release_ip"].includes(r.action) && r.saving > 0);
  const neverTouched = data.recs.filter((r) => ["keep", "review", "investigate"].includes(r.action));
  const kg = plan.items.reduce((x, i) => x + (i.saving > 0 ? i.rec.carbon.kg_co2 : 0), 0);
  const medium = plan.items.filter((i) => i.rec.risk !== "LOW" && i.saving > 0);
  const tone = !plan.reached ? "bad" : plan.counts.HIGH || plan.counts.MEDIUM ? "warn" : "save";

  const apply = () => {
    setMany(optional.filter((r) => !chosenIds.has(r.id)).map((r) => r.id), false);
    setMany([...chosenIds], true);
    setApplied(true);
  };

  return (
    <div className="space-y-5">
      <PageTitle kicker="Planner" title="Hit my target"
        sub="Pick how much to cut. The planner finds the least risky set of recommendations that gets there, using low-risk changes before medium and medium before high, and tells you plainly when a target cannot be reached safely." />

      <div className="card card-pad space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 font-semibold text-slate-900"><Crosshair size={16} /> Cut the bill by</span>
          <input type="number" className="select w-20 text-right tabular-nums" value={pct} min={1} max={scale} step={0.5}
            onChange={(e) => { setPct(Math.max(0.5, Math.min(scale, +e.target.value || 0))); setApplied(false); }} />
          <span className="text-sm text-slate-500">% of today&apos;s {inrShort(bill)}/month = <b className="text-slate-900">{inr(plan.target)}</b></span>
          <div className="ml-auto flex flex-wrap gap-2">
            {[5, 10, 15, 20].map((p) => (
              <button key={p} className={cls("btn-ghost", pct === p && "border-brand-500")} onClick={() => { setPct(p); setApplied(false); }}>{p}%</button>
            ))}
            <button className={cls("btn-ghost", pct === budgetPct && "border-brand-500")} onClick={() => { setPct(budgetPct); setApplied(false); }}
              title={`Projected next month ${inr(s.projected_next_month)} − budget ${inr(s.budget_monthly)}`}>
              Get under budget ({budgetPct}%)
            </button>
          </div>
        </div>

        {/* the slider sits on the three risk tiers, so you see what each target costs in risk */}
        <div>
          <input type="range" min={0.5} max={scale} step={0.5} value={pct} aria-label="Target percent"
            onChange={(e) => { setPct(+e.target.value); setApplied(false); }} className="w-full" />
          <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: `${(low.pct / scale) * 100}%` }} />
            <div className="absolute inset-y-0 bg-amber-500/70" style={{ left: `${(low.pct / scale) * 100}%`, width: `${((med.pct - low.pct) / scale) * 100}%` }} />
            <div className="absolute inset-y-0 bg-red-500/70" style={{ left: `${(med.pct / scale) * 100}%`, width: `${((all.pct - med.pct) / scale) * 100}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${(Math.min(pct, scale) / scale) * 100}%` }} />
          </div>
          <div className="mt-2 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Low risk alone: up to <b className="text-slate-900">{low.pct.toFixed(1)}%</b> ({inrShort(low.saving)})</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />Plus medium: up to <b className="text-slate-900">{med.pct.toFixed(1)}%</b> ({inrShort(med.saving)})</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Everything safe: <b className="text-slate-900">{all.pct.toFixed(1)}%</b> ({inrShort(all.saving)})</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />Beyond {all.pct.toFixed(1)}%: not offered, it would break a safety check</span>
          </div>
        </div>
      </div>

      <div className={cls("card flex items-start gap-3 p-4",
        tone === "save" ? "border-emerald-200" : tone === "warn" ? "border-amber-200" : "border-red-200")}>
        {tone === "save" ? <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={18} />
          : <ShieldAlert className={cls("mt-0.5 shrink-0", tone === "warn" ? "text-amber-600" : "text-red-600")} size={18} />}
        <div className="text-sm">
          <div className="font-semibold text-slate-900">{plan.message}</div>
          {medium.length > 0 && plan.reached && (
            <div className="mt-1 text-slate-500">
              Every low-risk change together saves {inr(low.saving)}, short of the {inr(plan.target)} target, so these were needed: {medium.map((i) => i.rec.resource_name).join(", ")}.
            </div>
          )}
          {!plan.reached && (
            <div className="mt-1 text-slate-500">The plan below is the most the safety rules allow. To go further you would have to shrink VMs whose peaks do not fit a smaller size.</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Plan saving" tone="save" value={inrShort(plan.saving)} sub={`${plan.achievedPct.toFixed(1)}% of the bill · ${inrShort(plan.saving * 12)} a year`} />
        <Kpi label="Changes" value={plan.counts.LOW + plan.counts.MEDIUM + plan.counts.HIGH}
          sub={`${plan.counts.LOW} low · ${plan.counts.MEDIUM} medium · ${plan.counts.HIGH} high risk`} />
        <Kpi label="Plan risk score" tone={tone === "bad" ? "bad" : tone} value={plan.planRisk.toFixed(2)}
          sub="saving-weighted average, 0 = safest, below 0.33 = low band" />
        <Kpi label="Carbon avoided" tone="save" value={`${kg.toFixed(0)} kg`} sub="CO₂ per month (from the chosen cards)" />
      </div>

      <details className="card card-pad text-sm">
        <summary className="cursor-pointer font-semibold text-slate-900">Show the maths</summary>
        <div className="mono mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-slate-600">
          <div>target = {inr(bill)} × {pct}% = {inr(plan.target)}/month (net saving)</div>
          <div>required upsizes add {inr(plan.upsizeCost)}/month, so the optional changes must save ≥ {inr(plan.target + plan.upsizeCost)}</div>
          <div>each VM offers: nothing · resize · schedule · resize + schedule (the schedule is priced on the new size)</div>
          <div>exact search over every combination (₹100 steps), ranked by: fewest high-risk → fewest medium-risk → lowest total risk score → fewest changes → least overshoot</div>
          <div>never picked: {neverTouched.length} cards with no safe action (peak protected, owner review, anomaly under investigation)</div>
          <div>plan saving = {inr(plan.saving)} = {plan.achievedPct.toFixed(2)}% of the bill{plan.reached ? ` ≥ ${pct}% ✓` : ` < ${pct}% ✗`}</div>
          <div>plan risk = Σ(risk score × saving) ÷ Σ saving = {plan.planRisk.toFixed(3)}</div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={apply}><CheckCircle2 size={15} /> Apply this plan</button>
        {applied
          ? <span className="text-sm text-save-700">Applied: the plan&apos;s cards are accepted and the rest rejected. See <Link className="underline" href="/savings">Before vs after</Link> or export it from <Link className="underline" href="/report">Report &amp; export</Link> (CSV, Terraform, shell script).</span>
          : <span className="text-sm text-slate-500">Accepts the plan&apos;s cards and rejects the other optional ones, so Before vs after and the Terraform export show exactly this plan.</span>}
      </div>

      {([1, 2, 3] as const).map((ph) => {
        const rows = plan.items.filter((i) => i.phase === ph);
        if (!rows.length) return null;
        return <PhaseTable key={ph} phase={ph} rows={rows} onDrop={(id) => saveExcluded([...excluded, id])} />;
      })}

      {excluded.length > 0 && (
        <div className="card card-pad text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">You dropped {excluded.length} change{excluded.length > 1 ? "s" : ""}: the plan was rebuilt without {excluded.length > 1 ? "them" : "it"}</h3>
            <button className="btn-ghost" onClick={() => saveExcluded([])}><Undo2 size={14} /> Restore all</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {excluded.map((id) => {
              const r = data.recs.find((x) => x.id === id);
              return r && (
                <button key={id} className="btn-ghost" onClick={() => saveExcluded(excluded.filter((x) => x !== id))}>
                  {r.resource_name} · {ACTION_LABEL[r.action]} <Undo2 size={12} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card card-pad text-sm">
        <h3 className="font-semibold text-slate-900">Never touched by any target</h3>
        <p className="mt-1 text-slate-500">However high the target, these stay as they are: their peaks would not fit a smaller size, they are production and need the owner, or their data is abnormal.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {neverTouched.map((r) => (
            <Link key={r.id} href={`/resources/${r.resource_id}`} className="chip bg-slate-100 text-slate-700 hover:underline">
              {r.resource_name} · {ACTION_LABEL[r.action]}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhaseTable({ phase, rows, onDrop }: { phase: 1 | 2 | 3; rows: PlanItem[]; onDrop: (id: string) => void }) {
  const total = rows.reduce((s, i) => s + i.saving, 0);
  return (
    <div className="card overflow-x-auto p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{PHASES[phase].title}</h3>
        <span className="text-sm tabular-nums text-save-700">{inr(total)}/month</span>
      </div>
      <p className="text-xs text-slate-500">{PHASES[phase].sub}</p>
      <table className="mt-2 w-full min-w-[640px] text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-500">
          <th className="py-1">Resource</th><th>Change</th><th>Env</th><th>Risk</th><th className="text-right">Score</th><th className="text-right">Saving / month</th><th />
        </tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.rec.id} className="border-t border-slate-100">
              <td className="py-1.5 font-medium"><Link href={`/resources/${i.rec.resource_id}`} className="hover:underline">{i.rec.resource_name}</Link></td>
              <td className="text-slate-600">{i.rec.title}{i.rec.action === "schedule" && i.saving !== i.rec.saving ? " (on current size)" : ""}</td>
              <td><EnvPill env={i.rec.env} /></td>
              <td><RiskPill risk={i.rec.risk} /></td>
              <td className="text-right font-mono text-xs tabular-nums text-slate-500">{i.rec.risk_score.toFixed(2)}</td>
              <td className={cls("text-right tabular-nums", i.saving < 0 ? "text-amber-600" : "text-save-700")}>{inr(i.saving)}</td>
              <td className="text-right">
                {i.rec.action !== "upsize" && (
                  <button className="text-slate-400 hover:text-red-600" title="Drop this change and re-plan" onClick={() => onDrop(i.rec.id)}><X size={14} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
