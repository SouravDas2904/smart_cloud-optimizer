"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ChevronRight, Crosshair, ShieldAlert, ShieldCheck, Undo2, X } from "lucide-react";
import { useApp } from "../providers";
import { EnvPill, Loading, PageTitle, RiskPill } from "@/components/ui";
import { planForTarget, type PlanItem } from "@/lib/engine";
import { ACTION_LABEL, cls, inr, inrShort } from "@/lib/format";

const KEY = "sco.target.excluded";
const PHASES = {
  1: { title: "Week 1", sub: "Clean-ups and required upsizes" },
  2: { title: "Week 2", sub: "Dev and staging" },
  3: { title: "Week 3", sub: "Production" },
} as const;
const GROUP_LABEL: Record<string, string> = {
  stop: "Stop idle VMs", delete_volume: "Delete orphaned volumes", release_ip: "Release unused IPs",
  upsize: "Required upsizes", resize: "Resizes", schedule: "Night & weekend schedules",
};

export default function HitMyTarget() {
  const { data, setMany } = useApp();
  const [pct, setPct] = useState(15);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);

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
  const choose = (p: number) => { setPct(p); setApplied(false); };

  const bill = data?.summary.current_monthly ?? 0;
  const plan = useMemo(
    () => (data ? planForTarget(data.recs, bill, pct, new Set(excluded)) : null),
    [data, bill, pct, excluded],
  );
  if (!data || !plan) return <Loading />;

  const s = data.summary;
  const budgetPct = Math.ceil(((s.projected_next_month - s.budget_monthly) / bill) * 1000) / 10;
  const [low, med, all] = plan.tiers;
  const scale = Math.max(25, Math.ceil(all.pct + 2));
  const at = (v: number) => `${(Math.min(v, scale) / scale) * 100}%`;
  const chosenIds = new Set(plan.items.map((i) => i.rec.id));
  const optional = data.recs.filter((r) => ["resize", "schedule", "stop", "delete_volume", "release_ip"].includes(r.action) && r.saving > 0);
  const neverTouched = data.recs.filter((r) => ["keep", "review", "investigate"].includes(r.action));
  const kg = plan.items.reduce((x, i) => x + (i.saving > 0 ? i.rec.carbon.kg_co2 : 0), 0);
  const attention = plan.items.filter((i) => i.rec.risk !== "LOW" && i.saving > 0)
    .sort((a, b) => (a.rec.risk === b.rec.risk ? b.saving - a.saving : a.rec.risk === "HIGH" ? -1 : 1));
  const [showAll, setShowAll] = [attentionOpen, setAttentionOpen];
  const nChanges = plan.counts.LOW + plan.counts.MEDIUM + plan.counts.HIGH;
  const tone = !plan.reached ? "bad" : plan.counts.HIGH || plan.counts.MEDIUM ? "warn" : "save";
  const toneText = { save: "text-emerald-600", warn: "text-amber-600", bad: "text-red-600" }[tone];
  const headline = !plan.reached ? "Not reachable safely" : tone === "save" ? "Low-risk only" : `Needs ${attention.length} riskier change${attention.length > 1 ? "s" : ""}`;

  const apply = () => {
    setMany(optional.filter((r) => !chosenIds.has(r.id)).map((r) => r.id), false);
    setMany([...chosenIds], true);
    setApplied(true);
  };

  return (
    <div className="space-y-6">
      <PageTitle kicker="Planner" title="Hit my target"
        sub="Pick how much to cut. We find the least risky set of changes that gets there, and say plainly when it can't be done safely." />

      {/* 1. the question and the answer, side by side */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card card-pad space-y-6 lg:col-span-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <div className="label flex items-center gap-1.5"><Crosshair size={13} /> Cut the bill by</div>
              <div className="mt-2 flex items-baseline gap-1">
                <input type="number" aria-label="Target percent" value={pct} min={0.5} max={scale} step={0.5}
                  onChange={(e) => choose(Math.max(0.5, Math.min(scale, +e.target.value || 0)))}
                  style={{ width: `${String(pct).length + 0.6}ch` }}
                  className="border-0 border-b border-slate-200 bg-transparent p-0 text-5xl font-semibold tabular-nums tracking-tight text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-0" />
                <span className="text-3xl font-semibold text-slate-400">%</span>
              </div>
            </div>
            <div className="pb-1 text-sm text-slate-500">
              = <b className="text-slate-900">{inr(plan.target)}</b> a month<br />of today&apos;s {inrShort(bill)} bill
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20].map((p) => (
              <button key={p} onClick={() => choose(p)}
                className={cls("rounded-full border px-3 py-1 text-sm transition-colors",
                  pct === p ? "border-brand-500 bg-brand-50 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-300")}>{p}%</button>
            ))}
            <button onClick={() => choose(budgetPct)} title={`Projected next month ${inr(s.projected_next_month)} − budget ${inr(s.budget_monthly)}`}
              className={cls("rounded-full border px-3 py-1 text-sm transition-colors",
                pct === budgetPct ? "border-brand-500 bg-brand-50 text-slate-900" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
              Get under budget · {budgetPct}%
            </button>
          </div>

          {/* the slider rides on the three risk tiers */}
          <div>
            <div className="relative h-8">
              <div className="absolute inset-x-0 top-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: at(low.pct) }} />
                <div className="absolute inset-y-0 bg-amber-500/70" style={{ left: at(low.pct), width: `${((med.pct - low.pct) / scale) * 100}%` }} />
                <div className="absolute inset-y-0 bg-red-500/70" style={{ left: at(med.pct), width: `${((all.pct - med.pct) / scale) * 100}%` }} />
              </div>
              <input type="range" min={0.5} max={scale} step={0.5} value={pct} aria-label="Target percent slider"
                onChange={(e) => choose(+e.target.value)}
                className="absolute inset-x-0 top-0 h-8 w-full cursor-pointer appearance-none bg-transparent accent-slate-900" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              {[
                { c: "bg-emerald-500", t: "Low risk", v: low },
                { c: "bg-amber-500", t: "+ Medium", v: med },
                { c: "bg-red-500", t: "Everything safe", v: all },
              ].map((x) => (
                <div key={x.t}>
                  <div className="flex items-center gap-1.5 text-slate-500"><span className={cls("h-2 w-2 rounded-full", x.c)} />{x.t}</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">up to {x.v.pct.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card card-pad flex flex-col lg:col-span-2">
          <div className={cls("label flex items-center gap-1.5", toneText)}>
            {tone === "save" ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />} {headline}
          </div>
          <div className="mt-3 text-5xl font-semibold tabular-nums tracking-tight text-save-600">{inrShort(plan.saving)}</div>
          <div className="mt-1 text-sm text-slate-500">a month · {plan.achievedPct.toFixed(1)}% of the bill · {inrShort(plan.saving * 12)} a year</div>

          {/* risk mix as one bar instead of three numbers */}
          <div className="mt-6">
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${(plan.counts.LOW / Math.max(1, nChanges)) * 100}%` }} />
              <div className="bg-amber-500" style={{ width: `${(plan.counts.MEDIUM / Math.max(1, nChanges)) * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${(plan.counts.HIGH / Math.max(1, nChanges)) * 100}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>{nChanges} changes: {plan.counts.LOW} low · {plan.counts.MEDIUM} medium · {plan.counts.HIGH} high</span>
              <span title="saving-weighted average risk score, 0 = safest">risk {plan.planRisk.toFixed(2)}</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">{kg.toFixed(0)} kg CO₂ avoided a month</div>

          <div className="mt-auto pt-6">
            {/* pale until used; green with a tick once the plan is applied */}
            <button onClick={apply}
              className={cls("btn w-full justify-center border py-2.5",
                applied
                  ? "border-[#22c55e]/50 bg-[#22c55e]/15 text-[#4ade80] hover:bg-[#22c55e]/20"
                  : "border-brand-500/30 bg-brand-500/10 text-brand-500 hover:border-brand-500/60 hover:bg-brand-500/20")}>
              {applied ? <><Check size={16} strokeWidth={2.5} /> Applied</> : <><CheckCircle2 size={15} /> Apply this plan</>}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              {applied
                ? <>Applied. See <Link className="underline" href="/savings">Before vs after</Link> or export from <Link className="underline" href="/report">Report</Link>.</>
                : "Accepts these cards and rejects the rest, so exports match."}
            </p>
          </div>
        </div>
      </div>

      {/* 2. one sentence on what it means */}
      <p className={cls("flex items-start gap-2 text-[15px] leading-relaxed", tone === "save" ? "text-slate-700" : "text-slate-900")}>
        <span className={cls("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", tone === "save" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-red-500")} />
        {plan.message}
      </p>

      {/* 3. only the changes that need a person's attention */}
      {attention.length > 0 && (
        <section>
          <h2 className="h-section">Worth a look before you apply</h2>
          <p className="mt-1 text-sm text-slate-500">
            {plan.reached
              ? `Low-risk changes alone save ${inrShort(low.saving)}, short of ${inrShort(plan.target)}. These close the gap. Drop one and the plan finds another way.`
              : "The most the safety rules allow includes these riskier changes."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(showAll ? attention : attention.slice(0, 6)).map((i) => (
              <div key={i.rec.id} className="card flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link href={`/resources/${i.rec.resource_id}`} className="font-medium text-slate-900 hover:underline">{i.rec.resource_name}</Link>
                  <div className="mt-0.5 truncate text-sm text-slate-500">{i.rec.title}</div>
                  <div className="mt-2 flex items-center gap-2"><EnvPill env={i.rec.env} /><RiskPill risk={i.rec.risk} /></div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="font-semibold tabular-nums text-save-700">{inrShort(i.saving)}</span>
                  <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => saveExcluded([...excluded, i.rec.id])}>Drop</button>
                </div>
              </div>
            ))}
          </div>
          {attention.length > 6 && (
            <button className="mt-3 text-sm text-slate-500 underline hover:text-slate-900" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${attention.length} (high risk first)`}
            </button>
          )}
        </section>
      )}

      {/* 4. the rollout, summarised; details on demand */}
      <section>
        <h2 className="h-section">Rollout</h2>
        <p className="mt-1 text-sm text-slate-500">Safest first. Each week runs a week before the next starts. Open a group to see every change.</p>
        <div className="mt-3 grid items-start gap-4 lg:grid-cols-3">
          {([1, 2, 3] as const).map((ph) => (
            <PhaseCard key={ph} phase={ph} rows={plan.items.filter((i) => i.phase === ph)}
              onDrop={(id) => saveExcluded([...excluded, id])} />
          ))}
        </div>
      </section>

      {/* 5. the rest, folded away */}
      <div className="space-y-3">
        {excluded.length > 0 && (
          <div className="card card-pad text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{excluded.length} change{excluded.length > 1 ? "s" : ""} dropped, plan rebuilt without {excluded.length > 1 ? "them" : "it"}</span>
              <button className="btn-ghost" onClick={() => saveExcluded([])}><Undo2 size={14} /> Restore all</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {excluded.map((id) => {
                const r = data.recs.find((x) => x.id === id);
                return r && (
                  <button key={id} className="chip bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => saveExcluded(excluded.filter((x) => x !== id))}>
                    {r.resource_name} · {ACTION_LABEL[r.action]} <Undo2 size={11} className="ml-1" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Fold title="Show the maths">
          <div className="mono space-y-1 text-slate-600">
            <div>target = {inr(bill)} × {pct}% = {inr(plan.target)}/month (net saving)</div>
            <div>required upsizes add {inr(plan.upsizeCost)}/month, so the optional changes must save ≥ {inr(plan.target + plan.upsizeCost)}</div>
            <div>each VM offers: nothing · resize · schedule · resize + schedule (the schedule is priced on the new size)</div>
            <div>exact search over every combination (₹100 steps), ranked by: fewest high-risk → fewest medium-risk → lowest total risk score → fewest changes → least overshoot</div>
            <div>plan saving = {inr(plan.saving)} = {plan.achievedPct.toFixed(2)}% of the bill{plan.reached ? ` ≥ ${pct}% ✓` : ` < ${pct}% ✗`}</div>
            <div>plan risk = Σ(risk score × saving) ÷ Σ saving = {plan.planRisk.toFixed(3)}</div>
          </div>
        </Fold>

        <Fold title={`Never touched by any target (${neverTouched.length})`}>
          <p className="text-slate-500">Their peaks would not fit a smaller size, they are idle production VMs waiting for the owner, or their data is abnormal.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {neverTouched.map((r) => (
              <Link key={r.id} href={`/resources/${r.resource_id}`} className="chip bg-slate-100 text-slate-700 hover:underline">
                {r.resource_name} · {ACTION_LABEL[r.action]}
              </Link>
            ))}
          </div>
        </Fold>
      </div>
    </div>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="card group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-medium text-slate-900">
        <ChevronRight size={15} className="text-slate-400 transition-transform group-open:rotate-90" /> {title}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function PhaseCard({ phase, rows, onDrop }: { phase: 1 | 2 | 3; rows: PlanItem[]; onDrop: (id: string) => void }) {
  const total = rows.reduce((s, i) => s + i.saving, 0);
  const groups = Object.entries(
    rows.reduce<Record<string, PlanItem[]>>((g, i) => ((g[i.rec.action] ??= []).push(i), g), {}),
  ).sort((a, b) => Math.abs(b[1].reduce((s, i) => s + i.saving, 0)) - Math.abs(a[1].reduce((s, i) => s + i.saving, 0)));
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="label">{PHASES[phase].title}</div>
          <div className="mt-1 font-semibold text-slate-900">{PHASES[phase].sub}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums text-save-600">{inrShort(total)}</div>
          <div className="text-xs text-slate-500">{rows.length} changes</div>
        </div>
      </div>
      {!rows.length && <p className="mt-4 text-sm text-slate-500">Nothing needed this week for this target.</p>}
      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        {groups.map(([action, items]) => {
          const sum = items.reduce((s, i) => s + i.saving, 0);
          const risky = items.filter((i) => i.rec.risk !== "LOW").length;
          return (
            <details key={action} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-sm">
                <ChevronRight size={14} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                <span className="text-slate-700">{GROUP_LABEL[action] ?? action}</span>
                <span className="text-xs text-slate-400">{items.length}</span>
                {risky > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title={`${risky} medium or high risk`} />}
                <span className={cls("ml-auto tabular-nums", sum < 0 ? "text-amber-600" : "text-slate-900")}>{sum < 0 ? `+${inrShort(-sum)} cost` : inrShort(sum)}</span>
              </summary>
              <ul className="mb-2 space-y-1 pl-6">
                {items.map((i) => (
                  <li key={i.rec.id} className="group/row flex items-center gap-2 text-xs">
                    <span className={cls("h-1.5 w-1.5 shrink-0 rounded-full",
                      i.rec.risk === "LOW" ? "bg-emerald-500" : i.rec.risk === "MEDIUM" ? "bg-amber-500" : "bg-red-500")} />
                    <Link href={`/resources/${i.rec.resource_id}`} className="truncate text-slate-600 hover:underline">{i.rec.resource_name}</Link>
                    <span className="ml-auto tabular-nums text-slate-500">{inr(i.saving)}</span>
                    {i.rec.action !== "upsize"
                      ? <button className="text-slate-300 opacity-0 hover:text-red-600 group-hover/row:opacity-100" title="Drop and re-plan" onClick={() => onDrop(i.rec.id)}><X size={12} /></button>
                      : <span className="w-3" />}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}
