"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleAlert, IndianRupee, PiggyBank, Server } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "./providers";
import { Kpi, Loading } from "@/components/ui";
import { RecCard } from "@/components/RecCard";
import { ChartCard } from "@/components/ChartCard";
import { FleetGrid } from "@/components/FleetGrid";
import { CountUp, FadeIn, WasteTicker } from "@/components/motion";
import { totals } from "@/lib/engine";
import { AXIS, CURSOR, GRID, barLabel, inrTick } from "@/lib/chart";
import { ACTION_LABEL, CHART, ENV_COLOR, cls, inr, inrShort } from "@/lib/format";

export default function Overview() {
  const { data, accepted, role } = useApp();
  if (!data) return <Loading />;
  const { summary: s, recs, alerts } = data;
  const t = totals(data.resources, recs, accepted);
  const actionable = recs.filter((r) => r.default_accepted && r.saving > 0);
  const top = [...actionable].sort((a, b) => b.saving - a.saving).slice(0, 5);
  const bySum = (acts: string[]) => actionable.filter((r) => acts.includes(r.action)).reduce((x, r) => x + r.saving, 0);
  const costJump = alerts.find((a) => a.kind === "cost_jump");
  const anomaly = alerts.find((a) => a.kind === "anomaly");
  const critical = alerts.filter((a) => a.severity === "critical");
  const growth = s.bill_history.at(-1)!.inr / s.bill_history[s.bill_history.length - 7].inr - 1;

  const waste = [
    { name: "Over-provisioned VMs", value: bySum(["resize"]) },
    { name: "Always-on dev/staging", value: bySum(["schedule"]) },
    { name: "Idle VMs", value: bySum(["stop"]) },
    { name: "Orphaned disks & IPs", value: bySum(["delete_volume", "release_ip"]) },
  ];
  const env = Object.entries(s.by_env).map(([k, v]) => ({ name: k, value: v }));
  const team = Object.entries(s.by_team).map(([k, v]) => ({ name: k, value: v }));
  const fmtL = (n: number) => inrShort(n);

  const kpis = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Current monthly cost" count={s.current_monthly} fmt={fmtL} icon={<IndianRupee size={15} />}
        sub={<>Next month on current run-rate: <b className="whitespace-nowrap text-slate-800">{inrShort(s.projected_next_month)}</b></>} />
      <Kpi label={role === "engineer" ? "Savings found" : "Savings found (per year)"} tone="save"
        count={role === "engineer" ? s.potential_saving : s.potential_saving * 12} fmt={fmtL} icon={<PiggyBank size={15} />}
        sub={role === "engineer" ? `${((s.potential_saving / s.current_monthly) * 100).toFixed(1)}% of the bill · ${actionable.length} safe actions`
          : `${inrShort(s.potential_saving)}/month · ${((s.potential_saving / s.current_monthly) * 100).toFixed(1)}% of the bill`} />
      <Kpi label="Accepted so far" tone="save" count={t.saving} fmt={fmtL} icon={<Server size={15} />}
        sub={`${t.count} actions · net of ${inrShort(-(t.byAction.upsize ?? 0))} for upsizes · new bill ${inrShort(t.after)}/mo`} />
      {role === "finance" ? (
        <Kpi label="Budget gap next month" tone={s.projected_next_month > s.budget_monthly ? "bad" : "save"}
          count={s.projected_next_month - s.budget_monthly} fmt={fmtL} icon={<AlertTriangle size={15} />}
          sub={`Budget ${inrShort(s.budget_monthly)} · accepted savings ${t.saving >= s.projected_next_month - s.budget_monthly ? "close" : "do not close"} the gap`} />
      ) : (
        <Kpi label="Open alerts" tone={critical.length ? "bad" : "warn"} count={alerts.length} fmt={(n) => Math.round(n).toString()}
          icon={<AlertTriangle size={15} />} sub={`${critical.length} critical`} />
      )}
    </div>
  );

  const billChart = (
    <ChartCard title={`Why the bill grew ${(growth * 100).toFixed(0)}% in six months`} height={180}
      render={(big) => (
        <BarChart data={s.bill_history} margin={{ left: 0, right: 8, top: big ? 24 : 16 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="month" {...AXIS} />
          <YAxis tickFormatter={inrTick} {...AXIS} width={60} tickCount={4} />
          <Tooltip formatter={(v: number) => inr(v)} cursor={CURSOR} />
          <Bar isAnimationActive={false} dataKey="inr" name="Monthly bill" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {s.bill_history.map((_, i) => <Cell key={i} fill={i === s.bill_history.length - 1 ? "#ff5a4e" : "#3a3a40"} />)}
            <LabelList dataKey="inr" position="top" formatter={inrTick} style={barLabel(big)} />
          </Bar>
        </BarChart>
      )}
      footer={
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {costJump && <li>• <b>New capacity:</b> {costJump.why}</li>}
          <li>• <b>Waste that built up:</b> {inr(waste[0].value)}/mo in oversized VMs, {inr(waste[1].value)}/mo in dev/staging running nights and weekends,
            {" "}{inr(waste[2].value + waste[3].value)}/mo in idle VMs and forgotten disks/IPs.</li>
          {anomaly && <li>• <b>Incident:</b> {anomaly.title}, costing {inr(anomaly.cost_impact)} in extra egress so far. <Link href="/alerts" className="text-brand-600 underline">See alert</Link></li>}
        </ul>
      } />
  );

  const wasteCard = (
    <div className="card card-pad">
      <h2 className="font-semibold text-slate-900">Where the waste is</h2>
      <div className="mt-3 space-y-3">
        {waste.map((w, i) => (
          <div key={w.name}>
            <div className="flex justify-between text-sm"><span className="text-slate-600">{w.name}</span><b className="tabular-nums">{inr(w.value)}</b></div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full transition-[width] duration-700" style={{ width: `${(w.value / s.potential_saving) * 100}%`, background: CHART[i] }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
        {(["resize", "schedule", "stop", "keep", "upsize", "investigate"] as const).map((a) => (
          <Link key={a} href="/recommendations" className="rounded-lg bg-slate-50 p-2 transition-colors hover:bg-brand-50">
            <div className="text-lg font-semibold text-slate-900">{s.counts[a] ?? 0}</div>
            <div className="text-slate-500">{ACTION_LABEL[a]}</div>
          </Link>
        ))}
      </div>
    </div>
  );

  const envChart = (
    <ChartCard title="Monthly cost by environment" height={170}
      render={(big) => (
        <PieChart>
          <Pie isAnimationActive={false} data={env} dataKey="value" nameKey="name" innerRadius={big ? 110 : 48} outerRadius={big ? 180 : 76} paddingAngle={2}
            label={big ? ({ name, value }: { name: string; value: number }) => `${name} ${inrShort(value)}` : false} labelLine={big} fontSize={13}>
            {env.map((e) => <Cell key={e.name} fill={ENV_COLOR[e.name]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => inr(v)} />
        </PieChart>
      )}
      footer={
        <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {env.map((e) => (
            <li key={e.name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENV_COLOR[e.name] }} />
              <span className="capitalize text-slate-600">{e.name}</span><b className="tabular-nums">{inrShort(e.value)}</b>
              <span className="text-xs text-slate-400">({((e.value / s.current_monthly) * 100).toFixed(0)}%)</span>
            </li>
          ))}
        </ul>
      } />
  );

  const teamChart = (
    <ChartCard title="Monthly cost by team" height={200}
      render={(big) => (
        <BarChart data={team} layout="vertical" margin={{ left: 4, right: 40 }}>
          <XAxis type="number" tickFormatter={inrTick} {...AXIS} tickCount={4} />
          <YAxis type="category" dataKey="name" {...AXIS} width={84} />
          <Tooltip formatter={(v: number) => inr(v)} cursor={CURSOR} />
          <Bar isAnimationActive={false} dataKey="value" name="Monthly cost" fill="#c6f432" radius={[0, 6, 6, 0]} maxBarSize={22}>
            <LabelList dataKey="value" position="right" formatter={inrTick} style={barLabel(big)} />
          </Bar>
        </BarChart>
      )} />
  );

  return (
    <div className="space-y-5">
      <Hero />

      {role === "leadership" && <ExecBrief />}
      <FadeIn>{kpis}</FadeIn>

      {role !== "leadership" && (
        <FadeIn className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">{billChart}</div>
          <div className="lg:col-span-2">{wasteCard}</div>
        </FadeIn>
      )}

      {role === "finance" ? (
        <FadeIn className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3"><Chargeback /></div>
          <div className="space-y-5 lg:col-span-2"><ComponentChart />{teamChart}</div>
        </FadeIn>
      ) : (
        <FadeIn className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="h-section">Top 5 actions by saving</h2>
              <Link href="/recommendations" className="flex items-center gap-1 text-sm text-brand-600">All recommendations <ArrowRight size={14} /></Link>
            </div>
            <div className="space-y-2">{top.map((r) => <RecCard key={r.id} r={r} compact={role === "leadership"} />)}</div>
          </div>
          <div className="space-y-5 lg:col-span-2">
            {envChart}
            {role === "engineer" ? teamChart : billChart}
          </div>
        </FadeIn>
      )}
    </div>
  );
}

/** The opening panel: the headline number on the left, the live map of every VM on the right. */
function Hero() {
  const { data, role } = useApp();
  if (!data) return null;
  const { summary: s, recs } = data;
  const actionable = recs.filter((r) => r.default_accepted && r.saving > 0);
  const kicker = { engineer: "Monday morning · 30-day analysis", finance: "Cost and savings · 30-day analysis", leadership: "Executive summary · 30-day analysis" }[role];

  return (
    <section className="card overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col border-b border-slate-200 p-5 md:p-7 lg:border-b-0 lg:border-r">
          <div className="label text-brand-500">{kicker}</div>
          <h1 className="mt-4 text-[32px] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-900 md:text-[42px]">
            <span className="text-save-600"><CountUp value={s.potential_saving} format={inrShort} ms={1200} /></span> a month
            <br />is leaking out of this estate.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500">
            {s.n_vms} VMs and {s.n_resources - s.n_vms} disks and IPs across {Object.keys(s.by_region).length} regions,
            from {(s.n_points / 1e6).toFixed(1)} million readings taken every {s.step_min} minutes. Every saving below
            passed a peak-safety check on p99, not the average.
          </p>
          <div className="mt-5 flex items-baseline gap-2 font-mono text-[13px] text-slate-500">
            <span className="h-1.5 w-1.5 translate-y-[-1px] animate-blink rounded-full bg-red-500" />
            wasted since you opened this page
            <span className="text-[15px] text-red-600"><WasteTicker perMonth={s.potential_saving} /></span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
            <Link href="/recommendations" className="btn-primary">Review {actionable.length} actions <ArrowRight size={14} /></Link>
            <Link href="/resources/vm-086" className="btn-ghost">See the trap VM</Link>
          </div>
        </div>
        <div className="p-5 md:p-7">
          <div className="mb-4 flex items-center justify-between">
            <span className="label">Fleet map · {s.n_vms} VMs · height = p99 CPU</span>
            <span className="hidden font-mono text-[11.5px] text-slate-400 sm:block">prod → staging → dev</span>
          </div>
          <FleetGrid vms={data.resources.filter((r) => r.type === "vm")} recs={recs} />
        </div>
      </div>
    </section>
  );
}

/** Leadership: the whole story in four sentences, plus the decisions that need a person. */
function ExecBrief() {
  const { data, accepted } = useApp();
  if (!data) return null;
  const { summary: s, recs, alerts } = data;
  const t = totals(data.resources, recs, accepted);
  const reviews = recs.filter((r) => r.action === "review");
  const upsizes = recs.filter((r) => r.action === "upsize");
  const invest = recs.filter((r) => r.action === "investigate");
  const lowRisk = recs.filter((r) => r.default_accepted && r.saving > 0 && r.risk === "LOW").reduce((x, r) => x + r.saving, 0);
  const growth = s.bill_history.at(-1)!.inr / s.bill_history[0].inr - 1;
  const decisions = [
    ...invest.map((r) => ({ text: `Approve an investigation of ${r.resource_name}: abnormal CPU and traffic (possible compromise).`, href: "/alerts", tone: "bad" })),
    ...reviews.map((r) => ({ text: `Ask the ${r.team} team to confirm ${r.resource_name} is unused (idle production VM, ${inr(r.saving)}/mo).`, href: `/resources/${r.resource_id}`, tone: "warn" })),
    { text: `Approve ${upsizes.length} upsizes (+${inr(-upsizes.reduce((x, r) => x + r.saving, 0))}/mo) to stop slowdowns at peak.`, href: "/recommendations", tone: "warn" },
  ];
  return (
    <FadeIn>
      <div className="card card-pad grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h2 className="h-section">In one minute</h2>
          <ul className="mt-2 space-y-2 text-[15px] leading-relaxed text-slate-700">
            <li>The cloud bill is <b>{inrShort(s.current_monthly)}/month</b>, up <b>{(growth * 100).toFixed(0)}%</b> in six months, and next month overshoots the {inrShort(s.budget_monthly)} budget by <b className="text-red-600">{inrShort(s.projected_next_month - s.budget_monthly)}</b>.</li>
            <li>We found <b className="text-save-700">{inrShort(s.potential_saving)}/month ({inrShort(s.potential_saving * 12)}/year)</b> of safe savings; <b>{inrShort(lowRisk)}/month</b> of it is low-risk and can be approved today.</li>
            <li>With the actions accepted now, the bill drops to <b>{inrShort(t.after)}/month</b>, back under budget.</li>
            <li>{alerts.filter((a) => a.severity === "critical").length} critical issues need attention, including a possible security incident.</li>
          </ul>
        </div>
        <div className="lg:col-span-2">
          <h2 className="h-section">Decisions needed from you</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {decisions.map((d) => (
              <li key={d.text}>
                <Link href={d.href} className="flex gap-2 rounded-lg border border-slate-200 p-2.5 transition-colors hover:border-brand-500 hover:bg-brand-50">
                  <CircleAlert size={16} className={cls("mt-0.5 shrink-0", d.tone === "bad" ? "text-red-600" : "text-amber-600")} />
                  <span className="text-slate-700">{d.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </FadeIn>
  );
}

/** Finance: who spends what, and what each team saves (chargeback / showback). */
function Chargeback() {
  const { data, accepted } = useApp();
  if (!data) return null;
  const t = totals(data.resources, data.recs, accepted);
  const found: Record<string, number> = {};
  data.recs.filter((r) => r.default_accepted && r.saving > 0).forEach((r) => (found[r.team] = (found[r.team] ?? 0) + r.saving));
  const rows = Object.entries(t.byTeam).sort((a, b) => b[1].before - a[1].before);
  return (
    <div className="card card-pad overflow-x-auto">
      <h2 className="font-semibold text-slate-900">Chargeback by team</h2>
      <p className="text-xs text-slate-500">Monthly cost each team owns, savings found in their resources, and their bill after the accepted actions.</p>
      <table className="mt-3 w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-1.5">Team</th><th className="text-right">Cost now</th><th className="text-right">Savings found</th><th className="text-right">After accepted</th><th className="text-right">Per year saved</th><th className="text-right">Share of bill</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-slate-100">
              <td className="py-2 font-medium">{k}</td>
              <td className="text-right tabular-nums">{inr(v.before)}</td>
              <td className="text-right tabular-nums text-save-700">{inr(found[k] ?? 0)}</td>
              <td className="text-right tabular-nums">{inr(v.before - v.saving)}</td>
              <td className="text-right tabular-nums text-save-700">{inrShort(v.saving * 12)}</td>
              <td className="text-right">
                <div className="ml-auto flex w-24 items-center justify-end gap-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(v.before / t.before) * 100}%` }} /></div>
                  <span className="w-8 text-right text-xs tabular-nums text-slate-500">{((v.before / t.before) * 100).toFixed(0)}%</span>
                </div>
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <td className="py-2">Total</td><td className="text-right tabular-nums">{inr(t.before)}</td>
            <td className="text-right tabular-nums text-save-700">{inr(Object.values(found).reduce((a, b) => a + b, 0))}</td>
            <td className="text-right tabular-nums">{inr(t.after)}</td><td className="text-right tabular-nums text-save-700">{inrShort(t.saving * 12)}</td><td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ComponentChart() {
  const { data } = useApp();
  if (!data) return null;
  const label: Record<string, string> = { compute: "Compute (VMs)", storage: "Block storage", network: "Network egress", ip: "Public IPs" };
  const rows = Object.entries(data.summary.by_component).map(([k, v]) => ({ name: label[k] ?? k, value: v }));
  return (
    <ChartCard title="What the money is spent on" height={170}
      render={(big) => (
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 44 }}>
          <XAxis type="number" tickFormatter={inrTick} {...AXIS} tickCount={4} />
          <YAxis type="category" dataKey="name" {...AXIS} width={104} />
          <Tooltip formatter={(v: number) => inr(v)} cursor={CURSOR} />
          <Bar isAnimationActive={false} dataKey="value" name="Monthly cost" radius={[0, 6, 6, 0]} maxBarSize={22}>
            {rows.map((_, i) => <Cell key={i} fill={CHART[i]} />)}
            <LabelList dataKey="value" position="right" formatter={inrTick} style={barLabel(big)} />
          </Bar>
        </BarChart>
      )} />
  );
}
