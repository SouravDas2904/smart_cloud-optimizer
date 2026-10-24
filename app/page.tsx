"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, IndianRupee, PiggyBank, Server, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "./providers";
import { Kpi, Loading } from "@/components/ui";
import { FleetGrid } from "@/components/FleetGrid";
import { CountUp, WasteTicker } from "@/components/motion";
import { RecCard } from "@/components/RecCard";
import { totals } from "@/lib/engine";
import { ACTION_LABEL, CHART, ENV_COLOR, inr, inrShort } from "@/lib/format";

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
  const growth = s.bill_history.at(-1)!.inr / s.bill_history[s.bill_history.length - 7].inr - 1;

  const waste = [
    { name: "Over-provisioned VMs", value: bySum(["resize"]) },
    { name: "Always-on dev/staging", value: bySum(["schedule"]) },
    { name: "Idle VMs", value: bySum(["stop"]) },
    { name: "Orphaned disks & IPs", value: bySum(["delete_volume", "release_ip"]) },
  ];
  const env = Object.entries(s.by_env).map(([k, v]) => ({ name: k, value: v }));
  const team = Object.entries(s.by_team).map(([k, v]) => ({ name: k, value: v }));

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col border-b border-slate-200 p-5 md:p-7 lg:border-b-0 lg:border-r">
            <div className="label text-brand-500">Monday morning · 30-day analysis</div>
            <h1 className="mt-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-900 md:text-[40px]">
              <span className="text-save-600"><CountUp value={s.potential_saving} format={inrShort} ms={1200} /></span> a month
              <br />is leaking out of this estate.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500">
              {s.n_vms} VMs and {s.n_resources - s.n_vms} disks and IPs across {Object.keys(s.by_region).length} regions,
              from {(s.n_points / 1e6).toFixed(1)} million readings taken every {s.step_min} minutes. Every saving below
              passed a peak-safety check on p99, not the average.
            </p>
            <div className="mt-5 flex items-baseline gap-2 font-mono text-xs text-slate-500">
              <span className="h-1.5 w-1.5 translate-y-[-1px] animate-blink rounded-full bg-red-500" />
              wasted since you opened this page
              <span className="text-sm text-red-600"><WasteTicker perMonth={s.potential_saving} /></span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
              <Link href="/recommendations" className="btn-primary">Review {actionable.length} actions <ArrowRight size={14} /></Link>
              <Link href="/resources/vm-086" className="btn-ghost">See the trap VM</Link>
            </div>
          </div>
          <div className="p-5 md:p-7">
            <div className="mb-4 flex items-center justify-between">
              <span className="label">Fleet map · {s.n_vms} VMs · height = p99 CPU</span>
              <span className="hidden font-mono text-[10.5px] text-slate-400 sm:block">prod → staging → dev</span>
            </div>
            <FleetGrid vms={data.resources.filter((r) => r.type === "vm")} recs={recs} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Current monthly cost" count={s.current_monthly} fmt={inrShort} icon={<IndianRupee size={14} />}
          sub={<>Next month on current run-rate: <b className="text-slate-800">{inrShort(s.projected_next_month)}</b></>} />
        <Kpi label="Savings found" tone="save" count={s.potential_saving} fmt={inrShort} icon={<PiggyBank size={14} />}
          sub={`${((s.potential_saving / s.current_monthly) * 100).toFixed(1)}% of the bill · ${actionable.length} safe actions`} />
        <Kpi label="Accepted so far" tone="save" count={t.saving} fmt={inrShort} icon={<Server size={14} />}
          sub={`${t.count} actions · net of ${inrShort(-(t.byAction.upsize ?? 0))} for upsizes · new bill ${inrShort(t.after)}/mo`} />
        <Kpi label="Open alerts" tone={alerts.some((a) => a.severity === "critical") ? "bad" : "warn"} count={alerts.length} fmt={(n) => Math.round(n).toString()}
          icon={<AlertTriangle size={14} />} sub={`${alerts.filter((a) => a.severity === "critical").length} critical · ${alerts.length - alerts.filter((a) => a.severity === "critical").length} warnings`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="card card-pad lg:col-span-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-red-500" />
            <h2 className="font-semibold text-slate-900">Why the bill grew {(growth * 100).toFixed(0)}% in six months</h2>
          </div>
          <div className="mt-3 h-44">
            <ResponsiveContainer>
              <BarChart data={s.bill_history} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="#1c1c20" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#4a4a52" />
                <YAxis tickFormatter={(v) => inrShort(v)} tick={{ fontSize: 11 }} stroke="#4a4a52" width={70} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar isAnimationActive={false} dataKey="inr" name="Monthly bill" radius={[4, 4, 0, 0]}>
                  {s.bill_history.map((_, i) => <Cell key={i} fill={i === s.bill_history.length - 1 ? "#ff5a4e" : "#4a4a52"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {costJump && <li>• <b>New capacity:</b> {costJump.why}</li>}
            <li>• <b>Waste that built up:</b> {inr(waste[0].value)}/mo in oversized VMs, {inr(waste[1].value)}/mo in dev/staging running nights and weekends,
              {" "}{inr(waste[2].value + waste[3].value)}/mo in idle VMs and forgotten disks/IPs.</li>
            {anomaly && <li>• <b>Incident:</b> {anomaly.title}, costing {inr(anomaly.cost_impact)} in extra egress so far. <Link href="/alerts" className="text-brand-600 underline">See alert</Link></li>}
          </ul>
        </div>

        <div className="card card-pad lg:col-span-2">
          <h2 className="font-semibold text-slate-900">Where the waste is</h2>
          <div className="mt-3 space-y-3">
            {waste.map((w, i) => (
              <div key={w.name}>
                <div className="flex justify-between text-sm"><span className="text-slate-600">{w.name}</span><b className="tabular-nums">{inr(w.value)}</b></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full" style={{ width: `${(w.value / s.potential_saving) * 100}%`, background: CHART[i] }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
            {(["resize", "schedule", "stop", "keep", "upsize", "investigate"] as const).map((a) => (
              <div key={a} className="rounded-lg bg-slate-50 p-2">
                <div className="text-lg font-semibold text-slate-900">{s.counts[a] ?? 0}</div>
                <div className="text-slate-500">{ACTION_LABEL[a]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="h-section">Top 5 actions by saving</h2>
            <Link href="/recommendations" className="flex items-center gap-1 text-sm text-brand-600">All recommendations <ArrowRight size={14} /></Link>
          </div>
          <div className="space-y-2">{top.map((r) => <RecCard key={r.id} r={r} compact={role === "leadership"} />)}</div>
        </div>
        <div className="space-y-5 lg:col-span-2">
          <div className="card card-pad">
            <h2 className="font-semibold text-slate-900">Monthly cost by environment</h2>
            <div className="flex items-center">
              <div className="h-40 w-40">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie isAnimationActive={false} data={env} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {env.map((e) => <Cell key={e.name} fill={ENV_COLOR[e.name]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => inr(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                {env.map((e) => (
                  <li key={e.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ENV_COLOR[e.name] }} />
                    <span className="w-16 capitalize text-slate-600">{e.name}</span><b className="tabular-nums">{inrShort(e.value)}</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {role !== "leadership" && (
            <div className="card card-pad">
              <h2 className="font-semibold text-slate-900">Monthly cost by team</h2>
              <div className="mt-2 h-48">
                <ResponsiveContainer>
                  <BarChart data={team} layout="vertical" margin={{ left: 10 }}>
                    <XAxis type="number" tickFormatter={(v) => inrShort(v)} tick={{ fontSize: 11 }} stroke="#4a4a52" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} stroke="#4a4a52" />
                    <Tooltip formatter={(v: number) => inr(v)} />
                    <Bar isAnimationActive={false} dataKey="value" name="Monthly cost" fill="#c6f432" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
