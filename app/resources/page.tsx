"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "../providers";
import { EnvPill, Loading, MultiSelect, PageTitle } from "@/components/ui";
import { ACTION_LABEL, cls, inr } from "@/lib/format";

function Meter({ v, warn = 80 }: { v: number; warn?: number }) {
  const c = v >= warn ? "bg-red-500" : v >= 50 ? "bg-amber-400" : v < 15 ? "bg-slate-300" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 rounded-full bg-slate-100"><div className={cls("h-1.5 rounded-full", c)} style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="w-9 text-xs tabular-nums text-slate-500">{v.toFixed(0)}%</span>
    </div>
  );
}

export default function Resources() {
  const { data } = useApp();
  const [q, setQ] = useState("");
  const [envs, setEnvs] = useState(["prod", "staging", "dev"]);
  const [types, setTypes] = useState(["vm", "volume", "ip"]);
  const [regions, setRegions] = useState<string[] | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [sort, setSort] = useState<"cost" | "cpu_p99" | "cpu_avg" | "mem_p99" | "disk_now" | "egress_gb_30d" | "name">("cost");

  const recByRes = useMemo(() => {
    const m: Record<string, string[]> = {};
    data?.recs.forEach((r) => (m[r.resource_id] ??= []).push(r.action));
    return m;
  }, [data]);

  if (!data) return <Loading />;
  const regs = Object.keys(data.summary.by_region);
  const tms = Object.keys(data.summary.by_team);
  const rows = data.resources
    .filter((r) => envs.includes(r.env) && types.includes(r.type) && (regions ?? regs).includes(r.region) && (teams ?? tms).includes(r.team)
      && (r.name.toLowerCase().includes(q.toLowerCase()) || r.id.includes(q)))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "cost" ? b.cost.total - a.cost.total
      : (b.stats?.[sort] ?? -1) - (a.stats?.[sort] ?? -1));
  const total = rows.reduce((s, r) => s + r.cost.total, 0);

  return (
    <div>
      <PageTitle title="Resource utilization" sub={<>Every VM, disk and IP with its CPU, memory, storage and network utilization and monthly cost. Click a VM for its full 30-day history, or see <Link href="/utilization" className="text-brand-600 underline">fleet-wide utilization</Link>.</>} />
      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
        <input className="select w-44" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <MultiSelect label="Type" options={["vm", "volume", "ip"]} value={types} onChange={setTypes} />
        <MultiSelect label="Env" options={["prod", "staging", "dev"]} value={envs} onChange={setEnvs} />
        <MultiSelect label="Region" options={regs} value={regions ?? regs} onChange={setRegions} />
        <MultiSelect label="Team" options={tms} value={teams ?? tms} onChange={setTeams} />
        <label className="flex items-center gap-2 text-xs text-slate-500">Sort
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="cost">Monthly cost</option><option value="cpu_p99">p99 CPU</option><option value="cpu_avg">Avg CPU</option><option value="mem_p99">p99 memory</option><option value="disk_now">Disk used</option><option value="egress_gb_30d">Network egress</option><option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="mb-2 text-sm text-slate-500">{rows.length} resources · {inr(total)}/month</div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Name</th><th>Env</th><th>Region</th><th>Team</th><th>Size</th><th>Avg CPU</th><th>p99 CPU</th><th>p99 Mem</th><th>Disk used</th><th>Egress 30d</th><th>Findings</th><th className="px-3 text-right">₹ / month</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  {r.type === "vm" ? <Link href={`/resources/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link> : <span className="font-medium">{r.name}</span>}
                  <div className="text-[11px] text-slate-400">{r.id}{r.type !== "vm" && (r.attached_to ? ` · attached to ${r.attached_to}` : " · unattached")}</div>
                </td>
                <td><EnvPill env={r.env} /></td>
                <td className="text-slate-600">{r.region}</td>
                <td className="text-slate-600">{r.team}</td>
                <td className="mono text-xs text-slate-600">{r.type === "vm" ? `${r.plan} (${r.vcpu}c/${r.ram_gb}G)` : r.type === "volume" ? `${r.disk_gb} GB` : "IPv4"}</td>
                <td>{r.stats ? <Meter v={r.stats.cpu_avg} /> : "—"}</td>
                <td>{r.stats ? <Meter v={r.stats.cpu_p99} /> : "—"}</td>
                <td>{r.stats ? <Meter v={r.stats.mem_p99} /> : "—"}</td>
                <td>{r.stats ? <Meter v={r.stats.disk_now} warn={85} /> : r.type === "volume" ? <span className="text-xs text-slate-400">{r.attached_to ? "attached" : "unattached"}</span> : "—"}</td>
                <td className="text-xs tabular-nums text-slate-600">{r.stats ? `${r.stats.egress_gb_30d.toLocaleString("en-IN")} GB` : "—"}</td>
                <td className="text-xs">
                  {(recByRes[r.id] ?? []).map((a) => (
                    <span key={a} className={cls("chip mr-1", a === "keep" ? "bg-emerald-50 text-emerald-700" : a === "investigate" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600")}>{ACTION_LABEL[a]}</span>
                  ))}
                  {!recByRes[r.id] && <span className="text-slate-400">Right-sized</span>}
                </td>
                <td className="px-3 text-right tabular-nums">{inr(r.cost.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
