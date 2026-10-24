"use client";

import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../providers";
import { Kpi, Loading, PageTitle } from "@/components/ui";
import { totals } from "@/lib/engine";
import { inr, inrShort } from "@/lib/format";

export default function Forecast() {
  const { data, accepted } = useApp();
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  if (!data) return <Loading />;
  const f = data.forecast;
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

  return (
    <div className="space-y-5">
      <PageTitle title="Cost forecast"
        sub={`Holt-Winters exponential smoothing (level + damped trend + weekly seasonality) on daily cost. Back-tested on the last 7 days: ${f.mape_7d}% average error. The green line applies the recommendations you have accepted.`}
        right={
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([30, 60, 90] as const).map((h) => (
              <button key={h} onClick={() => setHorizon(h)} className={horizon === h ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm" : "px-3 py-1 text-slate-500"}>{h} days</button>
            ))}
          </div>
        } />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Next ${horizon} days: do nothing`} value={inrShort(doNothing)} tone="bad" />
        <Kpi label={`Next ${horizon} days: optimised`} value={inrShort(optimised)} tone="save" />
        <Kpi label="Avoided spend" value={inrShort(doNothing - optimised)} tone="save" sub={`with ${t.count} accepted actions`} />
        <Kpi label="Budget (same period)" value={inrShort(budgetDaily * horizon)} sub={doNothing > budgetDaily * horizon ? "do-nothing path overruns" : "within budget"} />
      </div>
      <div className="card card-pad">
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ left: 10, right: 10, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#1c1c20" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#4a4a52" minTickGap={30} />
              <YAxis tickFormatter={(v) => inrShort(v)} tick={{ fontSize: 10 }} stroke="#4a4a52" width={70} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: number | number[]) => Array.isArray(v) ? `${inr(v[0])} – ${inr(v[1])}` : inr(v)} />
              <Legend />
              <Area dataKey="band" name="Forecast range" stroke="none" fill="#26262b" isAnimationActive={false} />
              <Line dataKey="actual" name="Actual daily cost" stroke="#0a0a0b" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Line dataKey="forecast" name="Do nothing" stroke="#ff5a4e" dot={false} strokeDasharray="5 3" isAnimationActive={false} />
              <Line dataKey="optimised" name="With accepted recommendations" stroke="#c6f432" dot={false} strokeWidth={2} isAnimationActive={false} />
              <ReferenceLine y={budgetDaily} stroke="#ff9f1c" strokeDasharray="4 4" label={{ value: "daily budget", fontSize: 10, fill: "#ffb44d", position: "insideBottomRight" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-slate-500">The jump mid-window is the 8 ML VMs launched by the Data team; the bump near the end is the anomaly&apos;s extra egress. The model has 30 days of history, so the range widens with the horizon.</p>
      </div>
    </div>
  );
}
