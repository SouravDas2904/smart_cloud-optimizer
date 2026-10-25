"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, isValidElement, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Area, Brush, ComposedChart, CartesianGrid, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/ChartCard";
import { AXIS, TOOLTIP, BRUSH, GRID } from "@/lib/chart";
import { useApp } from "../../providers";
import { EnvPill, Loading } from "@/components/ui";
import { RecCard } from "@/components/RecCard";
import { loadSeries } from "@/lib/dataset";
import { inr } from "@/lib/format";
import type { Series } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function heatColor(v: number) {
  const t = Math.min(1, v / 100);
  return `rgba(36, 87, 214, ${0.06 + t * 0.94})`;
}

export default function ResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const { data } = useApp();
  const [series, setSeries] = useState<Series | null>(null);
  const [range, setRange] = useState<7 | 14 | 30>(30);

  useEffect(() => {
    loadSeries<Series>(id).then(setSeries).catch(() => setSeries(null));
  }, [id]);

  const rows = useMemo(() => {
    if (!series) return [];
    const start = new Date(series.start).getTime();
    const n = series.cpu.length;
    const from = n - (range * 24 * 60) / series.step_min;
    return series.cpu.map((_, i) => ({
      t: start + i * series.step_min * 60000,
      cpu: series.cpu[i], cpu_max: series.cpu_max[i], mem: series.mem[i], disk: series.disk[i],
      iops: series.iops[i], net_in: series.net_in[i], net_out: series.net_out[i],
    })).slice(Math.max(0, from));
  }, [series, range]);

  if (!data) return <Loading />;
  const r = data.resources.find((x) => x.id === id);
  if (!r) return <div className="card p-6">Resource not found. <Link href="/resources" className="text-brand-600">Back</Link></div>;
  const st = r.stats!;
  const recs = data.recs.filter((x) => x.resource_id === id);
  const alert = data.alerts.find((a) => a.resource_id === id && a.kind === "anomaly");
  const fmtT = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  const fmtFull = (t: number) => new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

  const chart = (title: string, children: React.ReactNode, domain?: [number, number], unit = "%") => {
    // Recharts only sees direct children, so unwrap a <>...</> fragment
    const series = isValidElement(children) && children.type === Fragment
      ? (children.props as { children: React.ReactNode }).children : children;
    return (
      <ChartCard title={title} height={200} render={(big) => (
        <ComposedChart data={rows} margin={{ left: big ? 4 : -10, right: 8, top: big ? 10 : 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={big ? fmtFull : fmtT} {...AXIS} minTickGap={big ? 60 : 36} />
          <YAxis domain={domain ?? ["auto", "auto"]} {...AXIS} unit={unit} width={44} tickCount={5} />
          <Tooltip {...TOOLTIP} labelFormatter={(t: number) => fmtFull(t)} formatter={(v: number) => (v == null ? "—" : v.toFixed(1))} />
          {alert?.start && <ReferenceArea ifOverflow="hidden" x1={new Date(alert.start).getTime()} x2={new Date(alert.end!).getTime()} fill="#3a1512" fillOpacity={0.6} />}
          {series}
          {big && <Brush dataKey="t" {...BRUSH} tickFormatter={fmtT} />}
        </ComposedChart>
      )} />
    );
  };

  return (
    <div className="space-y-5">
      <Link href="/resources" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Resources</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{r.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <EnvPill env={r.env} /> {r.region} · {r.team} team · <span className="mono">{r.plan}</span> ({r.vcpu} vCPU / {r.ram_gb} GB, {r.disk_gb} GB disk) · {inr(r.cost.total)}/month
          </div>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {([7, 14, 30] as const).map((d) => (
            <button key={d} onClick={() => setRange(d)} className={range === d ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm" : "px-3 py-1 text-slate-500"}>{d} days</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[["Avg CPU", st.cpu_avg], ["p95 CPU", st.cpu_p95], ["p99 CPU", st.cpu_p99], ["Max CPU", st.cpu_max], ["p99 Memory", st.mem_p99], ["Disk used", st.disk_now]].map(([l, v]) => (
          <div key={l as string} className="card p-3">
            <div className="text-[12px] uppercase text-slate-500">{l}</div>
            <div className="text-xl font-semibold tabular-nums">{(v as number).toFixed(1)}%</div>
          </div>
        ))}
      </div>

      {recs.length > 0 && <div className="space-y-3">{recs.map((x) => <RecCard key={x.id} r={x} />)}</div>}

      {!series ? <Loading /> : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            {chart("CPU (30-min average, with 30-min peak)", <>
              <Area dataKey="cpu_max" stroke="none" fill="#4a5a1c" fillOpacity={0.6} name="peak" isAnimationActive={false} />
              <Line dataKey="cpu" stroke="#c6f432" dot={false} strokeWidth={1.5} name="avg" isAnimationActive={false} />
              <ReferenceLine y={st.cpu_p95} stroke="#ff9f1c" strokeDasharray="4 3" label={{ value: `p95 ${st.cpu_p95.toFixed(0)}%`, fontSize: 10, position: "insideTopLeft", fill: "#ffb44d" }} />
              <ReferenceLine y={st.cpu_p99} stroke="#ff5a4e" strokeDasharray="4 3" label={{ value: `p99 ${st.cpu_p99.toFixed(0)}%`, fontSize: 10, position: "insideTopRight", fill: "#ff8a80" }} />
            </>, [0, 100])}
            {chart("Memory", <>
              <Line dataKey="mem" stroke="#b48cff" dot={false} strokeWidth={1.5} name="mem" isAnimationActive={false} />
              <ReferenceLine y={st.mem_p99} stroke="#ff5a4e" strokeDasharray="4 3" label={{ value: `p99 ${st.mem_p99.toFixed(0)}%`, fontSize: 10, position: "insideTopRight", fill: "#ff8a80" }} />
            </>, [0, 100])}
            {chart("Disk used", <Line dataKey="disk" stroke="#5cc8ff" dot={false} strokeWidth={1.5} name="disk" isAnimationActive={false} />, [0, 100])}
            {chart("Network (MB/s)", <>
              <Line dataKey="net_in" stroke="#4fd1c5" dot={false} strokeWidth={1.2} name="in" isAnimationActive={false} />
              <Line dataKey="net_out" stroke="#ff7a1a" dot={false} strokeWidth={1.2} name="out" isAnimationActive={false} />
            </>, undefined, "")}
          </div>

          <div className="card card-pad overflow-x-auto">
            <h3 className="text-sm font-semibold text-slate-800">When is it busy? Average CPU by weekday and hour</h3>
            <p className="text-xs text-slate-500">Darker = busier. Off-hours windows that stay pale are candidates for scheduled shutdown.</p>
            <div className="mt-3 inline-grid min-w-[640px] gap-[2px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(20px, 1fr))" }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-center text-[11px] text-slate-400">{h}</div>)}
              {series.heatmap_cpu.map((row, d) => (
                <Fragment key={d}>
                  <div className="pr-1 text-right text-[12px] leading-5 text-slate-500">{DAYS[d]}</div>
                  {row.map((v, h) => <div key={`${d}-${h}`} title={`${DAYS[d]} ${h}:00 · ${v.toFixed(1)}%`} className="h-5 rounded-sm" style={{ background: heatColor(v) }} />)}
                </Fragment>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="text-sm font-semibold text-slate-800">Statistics used by the engine</h3>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              {Object.entries(st).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 py-1"><span className="mono text-xs text-slate-500">{k}</span><span className="tabular-nums">{String(v)}</span></div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
