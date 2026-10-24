"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, HardDrive, IndianRupee, Wallet } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Brush, Cell, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/ChartCard";
import { AXIS, BRUSH, fmtDay, inrTick } from "@/lib/chart";
import { useApp } from "../providers";
import { Loading, PageTitle } from "@/components/ui";
import { cls, inr, inrShort } from "@/lib/format";
import type { Alert, DayCost, Series } from "@/lib/types";

const ICON = { anomaly: AlertOctagon, capacity: HardDrive, cost_jump: IndianRupee, budget: Wallet };

function MetricMini({ a }: { a: Alert }) {
  const [s, setS] = useState<Series | null>(null);
  useEffect(() => { fetch(`/data/series/${a.resource_id}.json`).then((r) => r.json()).then(setS).catch(() => {}); }, [a.resource_id]);
  if (!s) return <div className="h-28" />;
  const start = new Date(s.start).getTime();
  const key = a.metric === "disk" ? "disk" : "cpu";
  const rows = s[key].map((v, i) => ({ t: start + i * s.step_min * 60000, v, out: s.net_out[i] }));
  return (
    <ChartCard bare title={`${a.resource_name}: ${key === "disk" ? "disk used" : "CPU"} over 30 days`} height={112} render={(big) => (
        <AreaChart data={rows} margin={{ left: big ? 0 : -20, right: 4, top: 4 }}>
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide={!big} tickFormatter={fmtDay} {...AXIS} minTickGap={60} />
          <YAxis domain={[0, 100]} {...AXIS} tick={{ fontSize: big ? 11 : 9, fill: "#94a3b8" }} unit="%" width={big ? 44 : 50} tickCount={big ? 5 : 3} />
          <Tooltip labelFormatter={(t: number) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} formatter={(v: number) => v?.toFixed(1)} />
          {a.start && <ReferenceArea ifOverflow="hidden" x1={new Date(a.start).getTime()} x2={new Date(a.end!).getTime()} fill="#fecaca" fillOpacity={0.7} />}
          {a.metric === "disk" && <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="3 3" />}
          <Area dataKey="v" stroke={a.kind === "anomaly" ? "#dc2626" : "#2457d6"} fill={a.kind === "anomaly" ? "#fee2e2" : "#dbe6ff"} isAnimationActive={false} dot={false} name={key} />
          {big && <Brush dataKey="t" {...BRUSH} tickFormatter={fmtDay} />}
        </AreaChart>
    )} />
  );
}

function CostMini({ days, date }: { days: DayCost[]; date: string }) {
  return (
    <ChartCard bare title="Daily cost over 30 days" sub="Amber = from the jump onwards" height={112} render={(big) => (
        <BarChart data={days} margin={{ left: -10, right: 4, top: 4 }}>
          <XAxis dataKey="date" hide={!big} {...AXIS} minTickGap={40} />
          <YAxis tickFormatter={inrTick} {...AXIS} tick={{ fontSize: big ? 11 : 9, fill: "#94a3b8" }} width={big ? 60 : 50} tickCount={big ? 5 : 3} />
          <Tooltip formatter={(v: number) => inr(v)} />
          <Bar isAnimationActive={false} dataKey="inr" name="daily cost" radius={[3, 3, 0, 0]}>{days.map((d) => <Cell key={d.date} fill={d.date >= date ? "#f59e0b" : "#cbd5e1"} />)}</Bar>
        </BarChart>
    )} />
  );
}

export default function Alerts() {
  const { data } = useApp();
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageTitle title="Alerts & insights"
        sub="Usage spikes, sudden cost increases, capacity trends and budget risk. Each alert explains why it fired. Anomalies are found with a robust z-score against the same hour on comparable days, so daily jobs that spike at the same time every day don't cause false alarms." />
      {data.alerts.map((a) => {
        const Icon = ICON[a.kind] ?? AlertTriangle;
        return (
          <div key={a.id} className={cls("card grid gap-4 p-4 md:grid-cols-5", a.severity === "critical" ? "border-l-4 border-l-red-500" : "border-l-4 border-l-amber-400")}>
            <div className="md:col-span-3">
              <div className="flex flex-wrap items-center gap-2">
                <Icon size={16} className={a.severity === "critical" ? "text-red-600" : "text-amber-600"} />
                <span className={cls("chip", a.severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>{a.severity}</span>
                <span className="chip bg-slate-100 text-slate-600">{a.kind.replace("_", " ")}</span>
                {a.team && <span className="text-xs text-slate-400">{a.region} · {a.team} · {a.env}</span>}
              </div>
              <h3 className="mt-1.5 font-semibold text-slate-900">{a.title}</h3>
              <p className="mt-1 text-sm text-slate-600"><b className="text-slate-700">Why: </b>{a.why}</p>
              <div className="mt-2 flex gap-3 text-sm">
                {a.cost_impact > 0 && <span className="text-slate-500">Impact: <b className="text-slate-800">{inr(a.cost_impact)}</b>{a.kind === "cost_jump" ? "/mo" : ""}</span>}
                {a.resource_id && <Link href={`/resources/${a.resource_id}`} className="text-brand-600 underline">Open resource</Link>}
                {a.kind === "budget" && <Link href="/recommendations" className="text-brand-600 underline">Close the gap</Link>}
              </div>
            </div>
            <div className="md:col-span-2">
              {a.resource_id ? <MetricMini a={a} /> : a.kind === "cost_jump" ? <CostMini days={data.forecast.history} date={a.date!} /> : (
                <div className="flex h-full flex-col justify-center gap-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Budget</span><b>{inr(data.summary.budget_monthly)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">Projected</span><b className="text-red-600">{inr(data.summary.projected_next_month)}</b></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-red-500" style={{ width: "100%" }} /></div>
                  <div className="text-xs text-slate-500">Savings found ({inr(data.summary.potential_saving)}) are larger than the overrun.</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
