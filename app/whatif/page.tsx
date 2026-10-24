"use client";

import { useState } from "react";
import { Leaf, Moon, SlidersHorizontal } from "lucide-react";
import { useApp } from "../providers";
import { EnvPill, Kpi, Loading, MultiSelect, PageTitle } from "@/components/ui";
import { carbon, offHoursFraction, whatIfHeadroom, whatIfSchedule } from "@/lib/engine";
import { inr, inrShort } from "@/lib/format";

const PRESETS = [
  { label: "Dev off 8 PM–8 AM + weekends", envs: ["dev"], start: 20, end: 8, weekends: true },
  { label: "Dev + staging off 8 PM–8 AM + weekends", envs: ["dev", "staging"], start: 20, end: 8, weekends: true },
  { label: "Non-prod off weekends only", envs: ["dev", "staging"], start: 0, end: 0, weekends: true },
  { label: "Everything off 10 PM–7 AM (risky!)", envs: ["prod", "staging", "dev"], start: 22, end: 7, weekends: false },
];

export default function WhatIf() {
  const { data } = useApp();
  const [envs, setEnvs] = useState(["dev"]);
  const [regions, setRegions] = useState<string[] | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [start, setStart] = useState(20);
  const [end, setEnd] = useState(8);
  const [weekends, setWeekends] = useState(true);
  const [conflictPct, setConflictPct] = useState(10);
  const [headroom, setHeadroom] = useState(70);
  if (!data) return <Loading />;
  const a = data.assumptions;
  const regs = Object.keys(data.summary.by_region);
  const tms = Object.keys(data.summary.by_team);
  const res = whatIfSchedule(data.resources, a, { envs, regions: regions ?? regs, teams: teams ?? tms, start, end, weekends, conflictPct });
  const hr = whatIfHeadroom(data.resources, data.recs, a, headroom / 100);
  const base = whatIfHeadroom(data.resources, data.recs, a, a.TARGET_CPU_UTIL);
  const co2 = carbon(a, res.vcpuHours);
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="space-y-5">
      <PageTitle title="What-if simulator" sub="Try a policy before you apply it. Savings and conflicts are recomputed instantly from each VM's 30-day weekday-by-hour usage profile." />

      <div className="card card-pad space-y-4">
        <div className="flex items-center gap-2 font-semibold text-slate-900"><Moon size={16} /> Scheduled shutdown</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn-ghost" onClick={() => { setEnvs(p.envs); setStart(p.start); setEnd(p.end); setWeekends(p.weekends); }}>{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <MultiSelect label="Env" options={["prod", "staging", "dev"]} value={envs} onChange={setEnvs} />
          <MultiSelect label="Region" options={regs} value={regions ?? regs} onChange={setRegions} />
          <MultiSelect label="Team" options={tms} value={teams ?? tms} onChange={setTeams} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">Stop at
            <select className="select" value={start} onChange={(e) => setStart(+e.target.value)}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          </label>
          <label className="flex items-center gap-2">Start at
            <select className="select" value={end} onChange={(e) => setEnd(+e.target.value)}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} /> Off all weekend</label>
          <label className="flex items-center gap-2">Flag a conflict if avg CPU in window &gt;
            <input type="number" className="select w-16" value={conflictPct} min={1} max={100} onChange={(e) => setConflictPct(+e.target.value)} />%
          </label>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 mono">
          off-hours fraction = {weekends ? `(${(24 - start + end) % 24 || 0} h × 5 weekdays + 48 weekend h) ÷ 168` : `${(24 - start + end) % 24} h × 7 ÷ 168`} = {(offHoursFraction(start, end, weekends) * 100).toFixed(1)}% of the week
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="VMs in scope" value={res.rows.length} sub={`${res.conflicts.length} would be affected`} />
        <Kpi label="Safe saving" tone="save" value={inrShort(res.saving)} sub="per month, conflicts excluded" />
        <Kpi label="If forced on all" tone={res.conflicts.length ? "warn" : "save"} value={inrShort(res.savingIfForced)} sub="includes VMs that are busy then" />
        <Kpi label="Carbon avoided" tone="save" value={`${co2.kg.toFixed(0)} kg`} icon={<Leaf size={16} />} sub={`CO₂ per month · ${co2.kwh.toFixed(0)} kWh`} />
      </div>

      {res.conflicts.length > 0 && (
        <div className="card overflow-x-auto border-amber-200 p-4">
          <h3 className="font-semibold text-amber-800">{res.conflicts.length} VMs are busy inside this window. Shutting them down would hurt users.</h3>
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">VM</th><th>Env</th><th>Team</th><th>Busiest slot in window</th><th className="text-right">Avg CPU then</th></tr></thead>
            <tbody>
              {res.conflicts.sort((x, y) => y.peakInWindow - x.peakInWindow).slice(0, 15).map((c) => (
                <tr key={c.r.id} className="border-t border-slate-100">
                  <td className="py-1.5 font-medium">{c.r.name}</td><td><EnvPill env={c.r.env} /></td><td>{c.r.team}</td><td>{c.busiest}</td>
                  <td className="text-right tabular-nums text-amber-700">{c.peakInWindow.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card card-pad space-y-3">
        <div className="flex items-center gap-2 font-semibold text-slate-900"><SlidersHorizontal size={16} /> Headroom policy</div>
        <p className="text-sm text-slate-500">How hot may a resized VM run at its p99 peak? Our default is {Math.round(a.TARGET_CPU_UTIL * 100)}% (30% headroom). Being more aggressive saves more, but pushes peaks closer to the ceiling.</p>
        <input type="range" min={40} max={95} step={5} value={headroom} onChange={(e) => setHeadroom(+e.target.value)} className="w-full max-w-md" />
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">Target p99 utilization: <b>{headroom}%</b> ({100 - headroom}% headroom)</div>
          <div className="rounded-lg bg-slate-50 p-3">Resizes: <b>{hr.count}</b> · saving <b className="text-save-700">{inr(hr.saving)}/mo</b>
            <span className="text-slate-500"> ({hr.saving >= base.saving ? "+" : ""}{inr(hr.saving - base.saving)} vs default)</span></div>
          <div className={`rounded-lg p-3 ${hr.riskyCount ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
            {hr.riskyCount ? <><b>{hr.riskyCount}</b> resized VMs would peak above 75%: not recommended</> : "All resized VMs keep peaks under 75%"}
          </div>
        </div>
      </div>
    </div>
  );
}
