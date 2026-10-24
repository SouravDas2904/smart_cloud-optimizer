"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/ChartCard";
import { AXIS, CURSOR, GRID, INK, barLabel, inrTick } from "@/lib/chart";
import { useApp } from "../providers";
import { Kpi, Loading, PageTitle } from "@/components/ui";
import { totals } from "@/lib/engine";
import { ACTION_LABEL, inr, inrShort } from "@/lib/format";

export default function Savings() {
  const { data, accepted } = useApp();
  if (!data) return <Loading />;
  const t = totals(data.resources, data.recs, accepted);

  // waterfall: current -> each action -> after
  const steps = Object.entries(t.byAction).sort((a, b) => b[1] - a[1]);
  let running = t.before;
  const water = [{ name: "Current", base: 0, value: t.before, kind: "total" }];
  for (const [a, v] of steps) {
    running -= v;
    water.push({ name: ACTION_LABEL[a], base: v >= 0 ? running : running + v, value: Math.abs(v), kind: v >= 0 ? "save" : "add" });
  }
  water.push({ name: "After", base: 0, value: t.after, kind: "total" });
  const color = { total: "#8c8c94", save: "#c6f432", add: "#ff9f1c" } as Record<string, string>;

  const accRecs = data.recs.filter((r) => accepted[r.id] && r.saving !== 0).sort((a, b) => b.saving - a.saving);

  return (
    <div className="space-y-5">
      <PageTitle title="Before vs after"
        sub="Projected monthly cost if the accepted recommendations are applied. It updates live as you accept or reject cards. Upsizes add cost (shown in amber) because reliability comes first." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Before" count={t.before} fmt={inrShort} sub="per month, all resources" />
        <Kpi label="After" count={t.after} fmt={inrShort} tone="save" sub={`${t.count} accepted actions`} />
        <Kpi label="Monthly saving" count={t.saving} fmt={inrShort} tone="save" sub={`${((t.saving / t.before) * 100).toFixed(1)}% lower bill`} />
        <Kpi label="Annual saving" count={t.saving * 12} fmt={inrShort} tone="save" sub="if applied for 12 months" />
      </div>

      <ChartCard title="Where the savings come from" height={300}
        sub="Start at today's bill, subtract each type of accepted action, end at the new bill. Amber bars add cost (upsizes)."
        render={(big) => (
          <BarChart data={water} margin={{ left: 10, right: 10, top: 22 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="name" {...AXIS} interval={0} tick={{ fontSize: big ? 12 : 10, fill: "#8c8c94" }} />
            <YAxis tickFormatter={inrTick} {...AXIS} width={64} allowDataOverflow tickCount={5}
              domain={[Math.floor((t.after * 0.85) / 50000) * 50000, Math.ceil((t.before * 1.02) / 50000) * 50000]} />
            <Tooltip formatter={(v: number, n) => (n === "base" ? null : inr(v))} cursor={CURSOR} />
            <Bar isAnimationActive={false} dataKey="base" stackId="a" fill="transparent" />
            <Bar isAnimationActive={false} dataKey="value" stackId="a" radius={[6, 6, 0, 0]} maxBarSize={72}>
              {water.map((w, i) => <Cell key={i} fill={color[w.kind]} />)}
              <LabelList dataKey="value" position="top" formatter={inrTick} style={{ ...barLabel(big), fill: INK.text, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        )} />

      <div className="grid gap-5 lg:grid-cols-2">
        {([["By environment", t.byEnv], ["By team", t.byTeam]] as const).map(([title, grp]) => (
          <div key={title} className="card card-pad overflow-x-auto">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1.5">Group</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Saving</th><th className="text-right">%</th></tr></thead>
              <tbody>
                {Object.entries(grp).sort((a, b) => b[1].before - a[1].before).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-2 capitalize">{k}</td>
                    <td className="text-right tabular-nums">{inr(v.before)}</td>
                    <td className="text-right tabular-nums">{inr(v.before - v.saving)}</td>
                    <td className="text-right font-medium tabular-nums text-save-700">{inr(v.saving)}</td>
                    <td className="text-right tabular-nums text-slate-500">{((v.saving / v.before) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <td className="py-2">Total</td><td className="text-right tabular-nums">{inr(t.before)}</td><td className="text-right tabular-nums">{inr(t.after)}</td>
                  <td className="text-right tabular-nums text-save-700">{inr(t.saving)}</td><td className="text-right tabular-nums">{((t.saving / t.before) * 100).toFixed(0)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="card card-pad overflow-x-auto">
        <h2 className="font-semibold text-slate-900">Per recommendation ({accRecs.length} accepted)</h2>
        <table className="mt-3 w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1.5">Resource</th><th>Action</th><th>Env</th><th>Team</th><th>Change</th><th className="text-right">Saving / mo</th></tr></thead>
          <tbody>
            {accRecs.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 font-medium">{r.resource_name}</td><td>{ACTION_LABEL[r.action]}</td><td>{r.env}</td><td>{r.team}</td>
                <td className="mono text-xs text-slate-500">{r.current_plan && r.target_plan && r.current_plan !== r.target_plan ? `${r.current_plan} → ${r.target_plan}` : "—"}</td>
                <td className={`text-right tabular-nums ${r.saving < 0 ? "text-amber-600" : "text-save-700"}`}>{inr(r.saving)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
