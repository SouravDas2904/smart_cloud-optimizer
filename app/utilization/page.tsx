"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import { Brush, CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/ChartCard";
import { AXIS, TOOLTIP, BRUSH, GRID, fmtDateTime } from "@/lib/chart";
import { useApp } from "../providers";
import { Kpi, Loading, MultiSelect, PageTitle } from "@/components/ui";
import { cls, inr } from "@/lib/format";
import type { FleetCells, FleetGroup, Resource } from "@/lib/types";

const METRICS = [
  { id: "cpu", label: "CPU", icon: Cpu },
  { id: "mem", label: "Memory", icon: MemoryStick },
  { id: "disk", label: "Storage", icon: HardDrive },
  { id: "net", label: "Network", icon: Network },
] as const;
type Metric = (typeof METRICS)[number]["id"];

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

function Meter({ v }: { v: number }) {
  const c = v >= 80 ? "bg-red-500" : v >= 50 ? "bg-amber-400" : v < 15 ? "bg-slate-300" : "bg-emerald-500";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="h-1.5 w-12 rounded-full bg-slate-100"><div className={cls("h-1.5 rounded-full", c)} style={{ width: `${Math.min(100, v)}%` }} /></div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-600">{v.toFixed(1)}%</span>
    </div>
  );
}

/** Capacity-weighted utilisation of a set of VMs, the same formula as engine/build.py: sum(used) / sum(provisioned). */
function groupStats(list: Resource[]): FleetGroup {
  const g = { vms: list.length, vcpu: 0, ram_gb: 0, disk_gb: 0, egress_gb: 0, cpu: 0, mem: 0, disk: 0 };
  for (const r of list) {
    const s = r.stats!;
    g.vcpu += r.vcpu; g.ram_gb += r.ram_gb; g.disk_gb += r.disk_gb; g.egress_gb += s.egress_gb_30d;
    g.cpu += (s.cpu_avg / 100) * r.vcpu; g.mem += (s.mem_avg / 100) * r.ram_gb; g.disk += (s.disk_now / 100) * r.disk_gb;
  }
  return { vms: g.vms, vcpu: g.vcpu, ram_gb: g.ram_gb, disk_gb: g.disk_gb, egress_gb: Math.round(g.egress_gb),
    cpu_pct: (g.cpu / g.vcpu) * 100, mem_pct: (g.mem / g.ram_gb) * 100, disk_pct: (g.disk / g.disk_gb) * 100 };
}

export default function Utilization() {
  const { data } = useApp();
  const [metric, setMetric] = useState<Metric>("cpu");
  const [by, setBy] = useState<"region" | "team" | "env">("region");
  const [envs, setEnvs] = useState(["prod", "staging", "dev"]);
  const [regions, setRegions] = useState<string[] | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [cells, setCells] = useState<FleetCells | null>(null);

  // per (region, env, team) hourly sums, only needed on this page (~1 MB, so not part of the shared load)
  useEffect(() => {
    fetch("/data/fleet_cells.json").then((r) => (r.ok ? r.json() : null)).then(setCells).catch(() => setCells(null));
  }, []);

  const regs = data ? Object.keys(data.summary.by_region) : [];
  const tms = data ? Object.keys(data.summary.by_team) : [];
  const keep = (r: { region: string; env: string; team: string }) =>
    envs.includes(r.env) && (regions ?? regs).includes(r.region) && (teams ?? tms).includes(r.team);

  // the hourly timeline for the selected VMs: add up the matching cells, then divide used by provisioned
  const rows = useMemo(() => {
    if (!data || !cells) return [];
    const sel = cells.cells.filter(keep);
    const start = new Date(cells.start).getTime();
    const n = cells.cells[0]?.vcpu_used.length ?? 0;
    const sum = (k: keyof FleetCells["cells"][number], i: number) => sel.reduce((s, c) => s + (c[k] as number[])[i], 0);
    const pct = (u: number, p: number) => (p > 0 ? +((u / p) * 100).toFixed(1) : null);
    return Array.from({ length: n }, (_, i) => ({
      t: start + i * cells.step_min * 60000,
      cpu: pct(sum("vcpu_used", i), sum("vcpu_prov", i)), mem: pct(sum("ram_used", i), sum("ram_prov", i)),
      disk: pct(sum("disk_used", i), sum("disk_prov", i)),
      net_in: +sum("net_in", i).toFixed(2), net_out: +sum("net_out", i).toFixed(2),
      vcpu_used: sum("vcpu_used", i), vcpu_prov: sum("vcpu_prov", i),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cells, envs, regions, teams]);

  if (!data) return <Loading />;
  const { resources } = data;
  const vms = resources.filter((r) => r.type === "vm" && r.stats && keep(r));
  const volumes = resources.filter((r) => r.type === "volume" && keep(r));
  const live = rows.filter((x) => x.cpu !== null);
  const cpuPct = live.map((x) => x.cpu!), memPct = live.map((x) => x.mem!);
  const filtered = vms.length < resources.filter((r) => r.type === "vm").length;
  const orphanGb = volumes.filter((r) => !r.attached_to).reduce((s, r) => s + r.disk_gb, 0);
  const vmDiskGb = vms.reduce((s, r) => s + r.disk_gb, 0);
  const usedGb = vms.reduce((s, r) => s + (r.stats!.disk_now / 100) * r.disk_gb, 0);
  const egressGb = vms.reduce((s, r) => s + r.stats!.egress_gb_30d, 0);
  const egressCost = vms.reduce((s, r) => s + r.cost.network, 0);
  const vcpuProv = live.at(-1)?.vcpu_prov ?? 0;
  const ramProv = vms.reduce((s, r) => s + r.ram_gb, 0);
  const fmtT = (x: number) => new Date(x).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  const top = (title: string, list: Resource[], val: (r: Resource) => number, fmt: (v: number) => string, why: string) => (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">{why}</p>
      <ol className="mt-2 space-y-1.5 text-sm">
        {list.slice(0, 5).map((r, i) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="w-4 text-xs text-slate-400">{i + 1}</span>
            <Link href={`/resources/${r.id}`} className="flex-1 truncate text-brand-700 hover:underline">{r.name}</Link>
            <span className="text-xs text-slate-400">{r.plan}</span>
            <b className="w-20 text-right tabular-nums">{fmt(val(r))}</b>
          </li>
        ))}
      </ol>
    </div>
  );
  const sorted = (f: (r: Resource) => number, asc = false) => [...vms].sort((a, b) => (asc ? f(a) - f(b) : f(b) - f(a)));

  const chart = {
    cpu: { keys: [["cpu", "CPU used % of provisioned vCPU", "#c6f432"]], unit: "%", note: "Share of all provisioned vCPUs that is actually busy, hour by hour (capacity-weighted)." },
    mem: { keys: [["mem", "Memory used % of provisioned RAM", "#b48cff"]], unit: "%", note: "Share of all provisioned RAM in use, hour by hour." },
    disk: { keys: [["disk", "Disk used % of provisioned storage", "#4fd1c5"]], unit: "%", note: "Share of VM disk capacity in use. Two prod disks are growing; see Alerts." },
    net: { keys: [["net_in", "Network in (MB/s)", "#5cc8ff"], ["net_out", "Network out (MB/s)", "#ff9f1c"]], unit: "", note: "Total traffic across the fleet. The jump on 20 Oct is the prod-pay-api-07 anomaly (25× normal egress)." },
  }[metric];

  return (
    <div className="space-y-5">
      <PageTitle title="Infrastructure utilization"
        sub={`CPU, memory, storage and network usage across all ${vms.length} VMs and ${volumes.length} block volumes, from 30 days of 5-minute readings. Percentages are capacity-weighted: a 16-vCPU VM counts eight times a 2-vCPU one.`} />

      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 p-3">
        <MultiSelect label="Env" options={["prod", "staging", "dev"]} value={envs} onChange={setEnvs} />
        <MultiSelect label="Region" options={regs} value={regions ?? regs} onChange={setRegions} />
        <MultiSelect label="Team" options={tms} value={teams ?? tms} onChange={setTeams} />
        <span className="ml-auto text-xs text-slate-500">{vms.length} VMs selected{filtered && <> · <button className="underline" onClick={() => { setEnvs(["prod", "staging", "dev"]); setRegions(null); setTeams(null); }}>clear filters</button></>}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="CPU utilization" value={live.length ? `${mean(cpuPct).toFixed(1)}%` : "–"} icon={<Cpu size={16} />}
          sub={live.length ? `${mean(live.map((x) => x.vcpu_used)).toFixed(0)} of ${vcpuProv.toFixed(0)} vCPUs busy on average · peak hour ${Math.max(...cpuPct).toFixed(0)}%` : "no VMs selected"} />
        <Kpi label="Memory utilization" value={live.length ? `${mean(memPct).toFixed(1)}%` : "–"} icon={<MemoryStick size={16} />}
          sub={live.length ? `of ${(ramProv / 1024).toFixed(1)} TB provisioned RAM · peak hour ${Math.max(...memPct).toFixed(0)}%` : "no VMs selected"} />
        <Kpi label="Storage used" value={vmDiskGb ? `${((usedGb / vmDiskGb) * 100).toFixed(1)}%` : "–"} icon={<HardDrive size={16} />}
          sub={`${(usedGb / 1024).toFixed(1)} of ${(vmDiskGb / 1024).toFixed(1)} TB on VM disks · ${(orphanGb / 1024).toFixed(1)} TB in unattached volumes`} />
        <Kpi label="Network egress (30 days)" value={`${(egressGb / 1024).toFixed(1)} TB`} icon={<Network size={16} />}
          sub={`${inr(egressCost)}/month at ₹${data.assumptions.EGRESS_INR_PER_GB as number}/GB`} />
      </div>

      <ChartCard title={filtered ? `Usage of the ${vms.length} selected VMs over 30 days (hourly)` : "Fleet usage over 30 days (hourly)"} sub={chart.note} height={260}
        actions={
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm" onClick={(e) => e.stopPropagation()}>
            {METRICS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setMetric(id)}
                className={cls("flex items-center gap-1.5 rounded-md px-3 py-1", metric === id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        }
        render={(big) => (
          <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={big ? fmtDateTime : fmtT} {...AXIS} minTickGap={big ? 70 : 44} />
            <YAxis {...AXIS} width={44} unit={chart.unit} tickCount={5} domain={chart.unit === "%" ? [0, 100] : [0, "auto"]} />
            <Tooltip {...TOOLTIP} labelFormatter={(x: number) => fmtDateTime(x)} formatter={(v: number) => v.toFixed(1)} />
            {big && <Legend verticalAlign="top" height={28} iconType="plainline" />}
            {chart.unit === "%" && <ReferenceLine y={70} stroke="#4a4a52" strokeDasharray="4 4" label={{ value: "70% target", fontSize: 11, fill: "#8c8c94", position: "insideTopRight" }} />}
            {chart.keys.map(([k, name, color]) => <Line key={k} isAnimationActive={false} dataKey={k} name={name} stroke={color} dot={false} strokeWidth={big ? 1.6 : 1.4} />)}
            {big && <Brush dataKey="t" {...BRUSH} tickFormatter={fmtT} />}
          </LineChart>
        )} />

      <div className="card card-pad overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Utilization by group</h2>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([["region", "Region"], ["team", "Team"], ["env", "Environment"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setBy(k)} className={cls("rounded-md px-3 py-1", by === k ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}>{l}</button>
            ))}
          </div>
        </div>
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-1.5">Group</th><th className="text-right">VMs</th><th className="text-right">vCPU</th><th className="text-right">CPU used</th>
              <th className="text-right">RAM</th><th className="text-right">Memory used</th><th className="text-right">Storage</th><th className="text-right">Disk used</th><th className="text-right">Egress 30d</th></tr>
          </thead>
          <tbody>
            {Object.entries(vms.reduce<Record<string, Resource[]>>((m, r) => ((m[r[by]] ??= []).push(r), m), {}))
              .sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) => [k, groupStats(list)] as const).map(([k, g]) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="py-2 font-medium capitalize">{k}</td>
                <td className="text-right tabular-nums">{g.vms}</td>
                <td className="text-right tabular-nums">{g.vcpu}</td>
                <td><Meter v={g.cpu_pct} /></td>
                <td className="text-right tabular-nums">{g.ram_gb} GB</td>
                <td><Meter v={g.mem_pct} /></td>
                <td className="text-right tabular-nums">{(g.disk_gb / 1024).toFixed(1)} TB</td>
                <td><Meter v={g.disk_pct} /></td>
                <td className="text-right tabular-nums">{(g.egress_gb / 1024).toFixed(1)} TB</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Low CPU and memory with high provisioned capacity is where rightsizing savings come from. Dev and staging sit near 7% CPU.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {top("Busiest CPU (p99)", sorted((r) => r.stats!.cpu_p99), (r) => r.stats!.cpu_p99, (v) => `${v.toFixed(0)}%`, "Candidates for an upsize or investigation")}
        {top("Most idle CPU (average)", sorted((r) => r.stats!.cpu_avg, true), (r) => r.stats!.cpu_avg, (v) => `${v.toFixed(1)}%`, "Candidates to stop or shrink")}
        {top("Highest memory (p99)", sorted((r) => r.stats!.mem_p99), (r) => r.stats!.mem_p99, (v) => `${v.toFixed(0)}%`, "Memory-bound: never shrink RAM here")}
        {top("Fullest disks", sorted((r) => r.stats!.disk_now), (r) => r.stats!.disk_now, (v) => `${v.toFixed(0)}%`, "Watch for capacity alerts")}
        {top("Busiest disk I/O (p95 IOPS)", sorted((r) => r.stats!.iops_p95), (r) => r.stats!.iops_p95, (v) => `${v.toFixed(0)} IOPS`, "Storage performance: keep these on fast disks")}
        {top("Most network egress (30 days)", sorted((r) => r.stats!.egress_gb_30d), (r) => r.stats!.egress_gb_30d, (v) => `${(v / 1024).toFixed(1)} TB`, "Egress is billed per GB")}
      </div>
    </div>
  );
}
