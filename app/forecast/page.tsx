"use client";

import { useState } from "react";
import { Area, Brush, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/ChartCard";
import { AXIS, TOOLTIP, BRUSH, GRID, fmtDay, inrTick } from "@/lib/chart";
import { useApp } from "../providers";
import { Kpi, Loading, PageTitle } from "@/components/ui";
import { totals } from "@/lib/engine";
import { inr, inrShort } from "@/lib/format";

export default function Forecast() {
  const { data, accepted } = useApp();
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [usage, setUsage] = useState<"cpu" | "mem">("cpu");
  if (!data) return <Loading />;
  const f = data.forecast;
  if (f.enabled === false || !f.usage) return <ForecastOff reason={f.disabled_reason} days={data.summary.window_days} />;
  const t = totals(data.resources, data.recs, accepted);
  const dailySaving = t.saving / (730 / 24);
  const budgetDaily = f.budget_monthly / (730 / 24);
  const fc = f.forecast.slice(0, horizon);
  const rows = [
    ...f.history.map((d) => ({ date: d.date, actual: d.inr })),
    ...fc.map((d) => ({ date: d.date, forecast: d.inr, band: [d.lo, d.hi] as [number, number], optimised: Math.round(d.inr - dailySaving) })),
  ];
  const sum = (k: "inr") => fc.reduce((s, d) => s + d[k], 0);
  const doNothing = sum("inr");
  const optimised = doNothing - dailySaving * horizon;

  // usage forecast: the same Holt-Winters model on daily fleet CPU % / memory % (engine/build.py: usage_forecast)
  const u = f.usage[usage];
  const uRows = [
    ...u.history.map((d) => ({ date: d.date, actual: d.pct })),
    ...u.forecast.slice(0, horizon).map((d) => ({ date: d.date, forecast: d.pct, band: [d.lo, d.hi] as [number, number] })),
  ];
  const uEnd = u.forecast[horizon - 1];

  return (
    <div className="space-y-5">
      <PageTitle title="Cost and usage forecast"
        sub={`Holt-Winters exponential smoothing (level + damped trend + weekly seasonality) on daily cost. ${f.mape_7d !== null ? `Back-tested on the last 7 days: ${f.mape_7d}% average error.` : "Not back-tested: that needs 21+ days of history."} The lime line applies the recommendations you have accepted.`}
        right={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([30, 60, 90] as const).map((h) => (
              <button key={h} onClick={() => setHorizon(h)} className={horizon === h ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm" : "px-3 py-1 text-slate-500"}>{h} days</button>
            ))}
          </div>
        } />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Next ${horizon} days: do nothing`} count={doNothing} fmt={inrShort} tone="bad" />
        <Kpi label={`Next ${horizon} days: optimised`} count={optimised} fmt={inrShort} tone="save" />
        <Kpi label="Avoided spend" value={inrShort(doNothing - optimised)} tone="save" sub={`with ${t.count} accepted actions`} />
        <Kpi label="Budget (same period)" value={inrShort(budgetDaily * horizon)} sub={doNothing > budgetDaily * horizon ? "do-nothing path overruns" : "within budget"} />
      </div>
      <ChartCard title="Daily cost: actual, forecast and optimised" height={320}
        sub="White = actual, red dashed = do nothing, lime = with your accepted recommendations, grey band = likely range."
        render={(big) => (
          <ComposedChart data={rows} margin={{ left: 4, right: 10, top: 8 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} minTickGap={big ? 50 : 36} tickFormatter={(d: string) => fmtDay(new Date(d).getTime())} />
            <YAxis tickFormatter={inrTick} {...AXIS} width={60} domain={["auto", "auto"]} tickCount={5} />
            <Tooltip {...TOOLTIP} formatter={(v: number | number[]) => Array.isArray(v) ? `${inr(v[0])} – ${inr(v[1])}` : inr(v)} />
            <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="band" name="Forecast range" stroke="none" fill="#26262b" isAnimationActive={false} />
            <Line dataKey="actual" name="Actual daily cost" stroke="#e8e8ea" dot={false} strokeWidth={1.6} isAnimationActive={false} />
            <Line dataKey="forecast" name="Do nothing" stroke="#ff5a4e" dot={false} strokeDasharray="5 3" isAnimationActive={false} />
            <Line dataKey="optimised" name="With accepted recommendations" stroke="#c6f432" dot={false} strokeWidth={2} isAnimationActive={false} />
            <ReferenceLine y={budgetDaily} stroke="#ff9f1c" strokeDasharray="4 4" label={{ value: "daily budget", fontSize: 11, fill: "#ffb44d", position: "insideBottomRight" }} />
            {big && <Brush dataKey="date" {...BRUSH} />}
          </ComposedChart>
        )}
        footer={<p className="mt-2 text-xs text-slate-500">{data.summary.data_source?.kind === "csv" ? "" : "The jump mid-window is the 8 ML VMs launched by the Data team; the bump near the end is the anomaly's extra egress. "}The model has {data.summary.window_days} days of history, so the range widens with the horizon.</p>} />

      <ChartCard title={`Fleet ${usage === "cpu" ? "CPU" : "memory"} usage: actual and forecast`} height={260}
        sub={`Daily average share of provisioned ${usage === "cpu" ? "vCPU" : "RAM"} in use, forecast with the same Holt-Winters model. ${u.mape_7d !== null ? `Back-tested on the last 7 days: ${u.mape_7d}% average error.` : "Not back-tested (needs 21+ days)."} In ${horizon} days: ${uEnd.pct.toFixed(1)}% (likely ${uEnd.lo.toFixed(1)}–${uEnd.hi.toFixed(1)}%).`}
        actions={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm" onClick={(e) => e.stopPropagation()}>
            {([["cpu", "CPU"], ["mem", "Memory"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setUsage(k)} className={usage === k ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm" : "px-3 py-1 text-slate-500"}>{l}</button>
            ))}
          </div>
        }
        render={(big) => (
          <ComposedChart data={uRows} margin={{ left: 4, right: 10, top: 8 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} minTickGap={big ? 50 : 36} tickFormatter={(d: string) => fmtDay(new Date(d).getTime())} />
            <YAxis {...AXIS} width={44} unit="%" domain={[0, 100]} tickCount={5} />
            <Tooltip {...TOOLTIP} formatter={(v: number | number[]) => Array.isArray(v) ? `${v[0].toFixed(1)}% – ${v[1].toFixed(1)}%` : `${v.toFixed(1)}%`} />
            <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="band" name="Forecast range" stroke="none" fill="#26262b" isAnimationActive={false} />
            <Line dataKey="actual" name="Actual (daily average)" stroke="#e8e8ea" dot={false} strokeWidth={1.6} isAnimationActive={false} />
            <Line dataKey="forecast" name="Forecast" stroke={usage === "cpu" ? "#c6f432" : "#b48cff"} dot={false} strokeDasharray="5 3" strokeWidth={1.8} isAnimationActive={false} />
            <ReferenceLine y={70} stroke="#4a4a52" strokeDasharray="4 4" label={{ value: "70% target", fontSize: 11, fill: "#8c8c94", position: "insideTopRight" }} />
          </ComposedChart>
        )} />
    </div>
  );
}

/** Uploaded data shorter than 14 days: say so instead of guessing (engine/build.py turns the forecast off). */
function ForecastOff({ reason, days }: { reason?: string | null; days: number }) {
  return (
    <div className="space-y-5">
      <PageTitle title="Cost and usage forecast" sub="Holt-Winters exponential smoothing on daily cost and fleet usage." />
      <div className="card card-pad max-w-2xl border-amber-500/30">
        <div className="label mb-2 text-amber-600">Forecast turned off for this data</div>
        <p className="text-sm leading-relaxed text-slate-700">
          {reason ?? `The forecast needs at least 14 days of history; this data has ${days}.`}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Rightsizing, the peak and spike checks, schedules, savings and Hit my target all still work on this data.
          Trend alerts also need 14 days and are off too.
        </p>
      </div>
    </div>
  );
}
