"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Cpu, HardDrive, MemoryStick, Network } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../providers";
import { Kpi, Loading, PageTitle } from "@/components/ui";
import { cls, inr } from "@/lib/format";
import type { FleetGroup, Resource } from "@/lib/types";

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

export default function Utilization() {
  const { data } = useApp();
  const [metric, setMetric] = useState<Metric>("cpu");
  const [by, setBy] = useState<"by_region" | "by_team" | "by_env">("by_region");

  const rows = useMemo(() => {
    if (!data) return [];
    const t = data.fleet.timeline;
    const start = new Date(t.start).getTime();
    return t.cpu_pct.map((_, i) => ({
      t: start + i * t.step_min * 60000, cpu: t.cpu_pct[i], mem: t.mem_pct[i], disk: t.disk_pct[i],
      net_in: t.net_in_mbps[i], net_out: t.net_out_mbps[i],
    }));
  }, [data]);

  if (!data) return <Loading />;
  const { fleet, resources } = data;
  const t = fleet.timeline;
  const vms = resources.filter((r) => r.type === "vm" && r.stats);
  const volumes = resources.filter((r) => r.type === "volume");
  const orphanGb = volumes.filter((r) => !r.attached_to).reduce((s, r) => s + r.disk_gb, 0);
  const vmDiskGb = vms.reduce((s, r) => s + r.disk_gb, 0);
  const usedGb = vms.reduce((s, r) => s + (r.stats!.disk_now / 100) * r.disk_gb, 0);
  const egressGb = vms.reduce((s, r) => s + r.stats!.egress_gb_30d, 0);
  const egressCost = vms.reduce((s, r) => s + r.cost.network, 0);
  const vcpuProv = t.vcpu_prov.at(-1)!;
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
    cpu: { keys: [["cpu", "CPU used % of provisioned vCPU", "#2457d6"]], unit: "%", note: "Share of all provisioned vCPUs that is actually busy, hour by hour (capacity-weighted)." },
    mem: { keys: [["mem", "Memory used % of provisioned RAM", "#8b5cf6"]], unit: "%", note: "Share of all provisioned RAM in use, hour by hour." },
    disk: { keys: [["disk", "Disk used % of provisioned storage", "#14b8a6"]], unit: "%", note: "Share of VM disk capacity in use. Two prod disks are growing; see Alerts." },
    net: { keys: [["net_in", "Network in (MB/s)", "#0ea5e9"], ["net_out", "Network out (MB/s)", "#f59e0b"]], unit: "", note: "Total traffic across the fleet. The jump on 20 Oct is the prod-pay-api-07 anomaly (25× normal egress)." },
  }[metric];

  return (
    <div className="space-y-5">
      <PageTitle title="Infrastructure utilization"
        sub={`CPU, memory, storage and network usage across all ${vms.length} VMs and ${volumes.length} block volumes, from 30 days of 5-minute readings. Percentages are capacity-weighted: a 16-vCPU VM counts eight times a 2-vCPU one.`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="CPU utilization" value={`${mean(t.cpu_pct).toFixed(1)}%`} icon={<Cpu size={16} />}
          sub={`${mean(t.vcpu_used).toFixed(0)} of ${vcpuProv.toFixed(0)} vCPUs busy on average · peak hour ${Math.max(...t.cpu_pct).toFixed(0)}%`} />
        <Kpi label="Memory utilization" value={`${mean(t.mem_pct).toFixed(1)}%`} icon={<MemoryStick size={16} />}
          sub={`of ${(ramProv / 1024).toFixed(1)} TB provisioned RAM · peak hour ${Math.max(...t.mem_pct).toFixed(0)}%`} />
        <Kpi label="Storage used" value={`${((usedGb / vmDiskGb) * 100).toFixed(1)}%`} icon={<HardDrive size={16} />}
          sub={`${(usedGb / 1024).toFixed(1)} of ${(vmDiskGb / 1024).toFixed(1)} TB on VM disks · ${(orphanGb / 1024).toFixed(1)} TB in unattached volumes`} />
        <Kpi label="Network egress (30 days)" value={`${(egressGb / 1024).toFixed(1)} TB`} icon={<Network size={16} />}
          sub={`${inr(egressCost)}/month at ₹${data.assumptions.EGRESS_INR_PER_GB as number}/GB`} />
      </div>

      <div className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Fleet usage over 30 days (hourly)</h2>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {METRICS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setMetric(id)}
                className={cls("flex items-center gap-1.5 rounded-md px-3 py-1", metric === id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{chart.note}</p>
        <div className="mt-3 h-64">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtT} tick={{ fontSize: 11 }} stroke="#94a3b8" minTickGap={40} />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={44} unit={chart.unit} domain={chart.unit === "%" ? [0, 100] : [0, "auto"]} />
              <Tooltip labelFormatter={(x: number) => new Date(x).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}
                formatter={(v: number) => v.toFixed(1)} />
              {chart.unit === "%" && <ReferenceLine y={70} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "70% target", fontSize: 10, fill: "#64748b", position: "insideTopRight" }} />}
              {chart.keys.map(([k, name, color]) => <Line key={k} isAnimationActive={false} dataKey={k} name={name} stroke={color} dot={false} strokeWidth={1.5} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card card-pad overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Utilization by group</h2>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {([["by_region", "Region"], ["by_team", "Team"], ["by_env", "Environment"]] as const).map(([k, l]) => (
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
            {Object.entries(fleet[by] as Record<string, FleetGroup>).map(([k, g]) => (
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
