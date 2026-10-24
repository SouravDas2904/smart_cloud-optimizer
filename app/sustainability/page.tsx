"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Leaf, TreePine, Zap } from "lucide-react";
import { useApp } from "../providers";
import { Kpi, Loading, PageTitle } from "@/components/ui";
import { carbon } from "@/lib/engine";

export default function Sustainability() {
  const { data, accepted } = useApp();
  if (!data) return <Loading />;
  const a = data.assumptions;
  const acc = data.recs.filter((r) => accepted[r.id] && r.vcpu_removed > 0);
  const vcpu = acc.reduce((s, r) => s + r.vcpu_removed, 0);
  const totalVcpu = data.resources.filter((r) => r.type === "vm").reduce((s, r) => s + r.vcpu, 0);
  const c = carbon(a, vcpu);
  const before = carbon(a, totalVcpu);
  const trees = (c.kg * 12) / a.KG_CO2_PER_TREE_YEAR;
  const byTeam: Record<string, number> = {};
  acc.forEach((r) => (byTeam[r.team] = (byTeam[r.team] ?? 0) + carbon(a, r.vcpu_removed).kg));
  const rows = Object.entries(byTeam).map(([team, kg]) => ({ team, kg: Math.round(kg) })).sort((x, y) => y.kg - x.kg);

  return (
    <div className="space-y-5">
      <PageTitle title="Sustainability" sub="Energy and carbon avoided by the recommendations you have accepted. It's an estimate based on average power per vCPU, data-centre overhead (PUE) and India's grid emission factor." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="vCPUs removed" value={vcpu.toFixed(0)} sub={`of ${totalVcpu} (${((vcpu / totalVcpu) * 100).toFixed(0)}%), averaged over the week`} />
        <Kpi label="Energy saved" tone="save" value={`${c.kwh.toFixed(0)} kWh`} icon={<Zap size={16} />} sub={`per month (fleet uses ~${before.kwh.toFixed(0)} kWh)`} />
        <Kpi label="CO₂ avoided" tone="save" value={`${c.kg.toFixed(0)} kg`} icon={<Leaf size={16} />} sub="per month" />
        <Kpi label="Tree equivalent" tone="save" value={trees.toFixed(0)} icon={<TreePine size={16} />} sub={`trees absorbing CO₂ for a year (${a.KG_CO2_PER_TREE_YEAR} kg each)`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="font-semibold text-slate-900">CO₂ avoided per team (kg / month)</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer>
              <BarChart data={rows} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis type="category" dataKey="team" width={84} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip />
                <Bar isAnimationActive={false} dataKey="kg" fill="#10b981" radius={[0, 4, 4, 0]} name="kg CO₂ / month" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card card-pad text-sm">
          <h2 className="font-semibold text-slate-900">How it is calculated</h2>
          <div className="mono mt-3 space-y-1 rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            <div>kWh/month = vCPU × {a.WATTS_PER_VCPU} W × {a.HOURS_PER_MONTH} h × PUE {a.PUE} ÷ 1000</div>
            <div>         = {vcpu.toFixed(1)} × {a.WATTS_PER_VCPU} × {a.HOURS_PER_MONTH} × {a.PUE} ÷ 1000 = {c.kwh.toFixed(1)} kWh</div>
            <div>kg CO₂   = kWh × {a.GRID_KG_CO2_PER_KWH} (India grid, CEA) = {c.kg.toFixed(1)} kg</div>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600">
            <li>Resize: vCPUs removed = current − target.</li>
            <li>Stop idle: all of the VM&apos;s vCPUs.</li>
            <li>Schedule: vCPUs × 64.3% (share of the week switched off).</li>
            <li>Simplification: idle vs busy power draw is not modelled separately.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
