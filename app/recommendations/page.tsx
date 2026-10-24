"use client";

import { useMemo, useState } from "react";
import { useApp } from "../providers";
import { Loading, MultiSelect, PageTitle } from "@/components/ui";
import { RecCard } from "@/components/RecCard";
import { totals } from "@/lib/engine";
import { ACTION_LABEL, inr } from "@/lib/format";

const TABS = [
  { id: "save", label: "Save money", actions: ["resize", "schedule", "stop", "delete_volume", "release_ip"] },
  { id: "attention", label: "Needs attention", actions: ["review", "upsize", "investigate"] },
  { id: "protected", label: "Peak protected", actions: ["keep"] },
];

export default function Recommendations() {
  const { data, accepted, setMany, resetDecisions } = useApp();
  const [tab, setTab] = useState("save");
  const [envs, setEnvs] = useState(["prod", "staging", "dev"]);
  const [risks, setRisks] = useState(["LOW", "MEDIUM", "HIGH"]);
  const [regions, setRegions] = useState<string[] | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [sort, setSort] = useState<"saving" | "risk" | "confidence">("saving");

  const list = useMemo(() => {
    if (!data) return [];
    const acts = TABS.find((t) => t.id === tab)!.actions;
    const regs = regions ?? Object.keys(data.summary.by_region);
    const tms = teams ?? Object.keys(data.summary.by_team);
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    return data.recs
      .filter((r) => acts.includes(r.action) && envs.includes(r.env) && risks.includes(r.risk) && regs.includes(r.region) && tms.includes(r.team))
      .sort((a, b) => sort === "saving" ? Math.abs(b.saving) - Math.abs(a.saving)
        : sort === "risk" ? rank[a.risk] - rank[b.risk] : b.confidence - a.confidence);
  }, [data, tab, envs, risks, regions, teams, sort]);

  if (!data) return <Loading />;
  const t = totals(data.resources, data.recs, accepted);
  const regs = Object.keys(data.summary.by_region);
  const tms = Object.keys(data.summary.by_team);
  const visibleSaving = list.filter((r) => accepted[r.id]).reduce((s, r) => s + r.saving, 0);

  return (
    <div className="pb-20">
      <PageTitle title="Recommendations"
        sub="Every card states the action, the reason, the monthly saving, the risk and how confident we are. Sizing always uses p99 peak load plus 30% headroom, never averages. You stay in control: accept or reject each one." />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tb) => {
          const n = data.recs.filter((r) => tb.actions.includes(r.action)).length;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={tab === tb.id ? "btn-primary" : "btn-ghost"}>{tb.label} <span className="opacity-70">({n})</span></button>
          );
        })}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
        <MultiSelect label="Env" options={["prod", "staging", "dev"]} value={envs} onChange={setEnvs} />
        <MultiSelect label="Region" options={regs} value={regions ?? regs} onChange={setRegions} />
        <MultiSelect label="Team" options={tms} value={teams ?? tms} onChange={setTeams} />
        <MultiSelect label="Risk" options={["LOW", "MEDIUM", "HIGH"]} value={risks} onChange={setRisks} />
        <label className="flex items-center gap-2 text-xs text-slate-500">Sort
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="saving">Biggest impact</option><option value="risk">Lowest risk</option><option value="confidence">Highest confidence</option>
          </select>
        </label>
        {tab === "save" && (
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={() => setMany(list.filter((r) => r.risk === "LOW").map((r) => r.id), true)}>Accept all low-risk shown</button>
            <button className="btn-ghost" onClick={() => setMany(list.map((r) => r.id), false)}>Reject all shown</button>
            <button className="btn-ghost" onClick={resetDecisions}>Reset</button>
          </div>
        )}
      </div>

      {tab === "protected" && (
        <div className="card mb-4 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>Why these are not downsized:</b> their <i>average</i> CPU is low, so a naive average-based tool would shrink them.
          But each has a short daily or nightly peak (report runs, batch jobs). Sized on average, they would fall over at that peak.
          We size on p99, so they keep their current size.
        </div>
      )}

      <div className="mb-2 text-sm text-slate-500">
        {list.length} shown{tab === "save" && <> · accepted here: <b className="text-save-700">{inr(visibleSaving)}/mo</b></>}
      </div>
      <div className="space-y-3">{list.map((r) => <RecCard key={r.id} r={r} />)}</div>
      {!list.length && <div className="card p-8 text-center text-sm text-slate-500">No recommendations match these filters.</div>}

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur md:left-56">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm md:px-6">
          <span>Before <b className="tabular-nums">{inr(t.before)}</b></span>
          <span>After <b className="tabular-nums">{inr(t.after)}</b></span>
          <span className="font-semibold text-save-700">Saving {inr(t.saving)}/mo ({((t.saving / t.before) * 100).toFixed(1)}%)</span>
          <span className="text-slate-500">{t.count} accepted · {Object.entries(t.byAction).map(([a, v]) => `${ACTION_LABEL[a]} ${inr(v)}`).join(" · ")}</span>
        </div>
      </div>
    </div>
  );
}
