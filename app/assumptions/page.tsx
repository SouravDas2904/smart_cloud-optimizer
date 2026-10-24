"use client";

import { useApp } from "../providers";
import { Loading, PageTitle } from "@/components/ui";
import { inr } from "@/lib/format";
import type { Resource, Stats } from "@/lib/types";

// [CPU %, % of Azure VMs with avg CPU <= x, % with p95 max CPU <= x] from azure2019_data_cpu.txt
const AZURE_CPU_CDF: [number, number, number][] = [[5, 44, 15], [10, 58, 21], [20, 75, 30], [50, 94, 54], [90, 99, 82]];

const share = (vms: Resource[], f: (s: Stats) => boolean) =>
  Math.round((vms.filter((r) => f(r.stats!)).length / vms.length) * 100);

export default function Assumptions() {
  const { data } = useApp();
  if (!data) return <Loading />;
  const a = data.assumptions as Record<string, number> & typeof data.assumptions;
  const rows: [string, string, string][] = [
    ["Data window", `${a.DAYS} days at ${a.STEP_MIN}-minute granularity (${a.POINTS_PER_DAY} points/day)`, "Meets the brief: ≥ 30 days at 5–15 min"],
    ["Hours per month", `${a.HOURS_PER_MONTH}`, "Industry standard (8,760 ÷ 12)"],
    ["Target CPU at p99 after resize", `${a.TARGET_CPU_UTIL * 100}%`, "30% headroom for unexpected load"],
    ["Target memory at p99 after resize", `${a.TARGET_MEM_UTIL * 100}% and ≥ ${a.MIN_MEM_MARGIN_GB} GB free`, "Running out of memory kills processes, so we keep a bigger buffer"],
    ["Idle", `p95 CPU < ${a.IDLE_CPU_P95}%, p95 network < ${a.IDLE_NET_P95_MBPS} MB/s, p95 IOPS < ${a.IDLE_IOPS_P95}, for ≥ ${a.IDLE_MIN_DAYS} days`, "Three signals must agree to avoid false idle calls"],
    ["Under-provisioned", `p99 CPU or memory > ${a.UNDER_P99}%`, "Recommend an upsize: reliability first"],
    ["Off-hours window", `${a.OFF_START_HOUR}:00–0${a.OFF_END_HOUR}:00 weekdays + weekends (IST) = ${(a.OFF_HOURS_FRACTION * 100).toFixed(1)}% of the week`, "Typical Indian engineering hours"],
    ["Schedulable", `non-prod and average CPU in the off window < ${a.OFFHOURS_CPU_MAX}%`, "Production is never scheduled"],
    ["Orphan grace period", `${a.ORPHAN_GRACE_DAYS} days`, "Don't flag a disk detached a few minutes ago"],
    ["Block storage", `₹${a.BLOCK_INR_PER_GB_MONTH}/GB-month (billed while a VM is stopped)`, "Illustrative"],
    ["Snapshot", `₹${a.SNAPSHOT_INR_PER_GB_MONTH}/GB-month`, "Kept as a safety net before deleting a volume"],
    ["Public IP", `${inr(a.PUBLIC_IP_INR_PER_MONTH)}/month whether used or not`, "Illustrative"],
    ["Egress", `₹${a.EGRESS_INR_PER_GB}/GB outbound`, "Illustrative"],
    ["Monthly budget", inr(a.MONTHLY_BUDGET_INR), "Set by leadership for the scenario"],
    ["Anomaly", `robust z-score > ${a.ANOMALY_Z} for ≥ ${a.ANOMALY_MIN_POINTS * a.STEP_MIN} min, vs median/MAD of the same hour on comparable days (first 21 days as baseline)`, "Robust to outliers; daily jobs aren't flagged"],
    ["Cost jump", `daily cost > ${a.COST_JUMP_PCT}% above trailing 7-day average`, ""],
    ["Capacity", `disk projected to hit ${a.CAPACITY_WARN_PCT}% within ${a.CAPACITY_HORIZON_DAYS} days (14-day linear fit)`, ""],
    ["Carbon", `${a.WATTS_PER_VCPU} W/vCPU, PUE ${a.PUE}, ${a.GRID_KG_CO2_PER_KWH} kg CO₂/kWh, ${a.KG_CO2_PER_TREE_YEAR} kg CO₂/tree/year`, "Cloud Carbon Footprint-style estimate; India CEA grid factor"],
    ["Random seed", `${a.SEED}`, "Same data every run: reproducible demo"],
  ];
  const plans = Object.entries(a.PLANS);
  const vms = data.resources.filter((r) => r.type === "vm" && r.stats);

  return (
    <div className="space-y-5">
      <PageTitle title="Assumptions sheet" sub="Every rupee and every threshold in this tool traces back to this page (source: engine/config.py). Prices are illustrative, as the brief allows; plug in a real price list and the engine needs no other change." />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Assumption</th><th>Value</th><th className="px-4">Why</th></tr></thead>
          <tbody>{rows.map(([k, v, w]) => <tr key={k} className="border-t border-slate-100"><td className="px-4 py-2 font-medium">{k}</td><td>{v}</td><td className="px-4 text-slate-500">{w}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4 font-semibold text-slate-900">Illustrative price list (same in all regions)</div>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Plan</th><th>vCPU</th><th>RAM</th><th className="text-right">₹/hour</th><th className="px-4 text-right">₹/month</th></tr></thead>
            <tbody>{plans.map(([p, [v, m, price]]) => (
              <tr key={p} className="border-t border-slate-100"><td className="mono px-4 py-1.5">{p}</td><td>{v}</td><td>{m} GB</td><td className="text-right tabular-nums">{(price / a.HOURS_PER_MONTH).toFixed(2)}</td><td className="px-4 text-right tabular-nums">{inr(price)}</td></tr>
            ))}</tbody>
          </table>
          <p className="px-4 pb-4 pt-2 text-xs text-slate-500">s- = standard, m- = memory-optimised.</p>
        </div>
        <div className="card card-pad space-y-3 text-sm text-slate-600">
          <div className="font-semibold text-slate-900">How the data was generated</div>
          <p>A Python generator (engine/generate.py) builds {data.summary.n_vms} VMs, 10 block volumes and 36 public IPs across Noida, Bangalore and Mumbai for 6 teams. Each VM&apos;s series is <span className="mono">base + daily shape × weekday factor + noise + events</span>.</p>
          <p>Patterns planted on purpose, as the brief asks: steady low-usage VMs, bursty VMs with short daily peaks, batch jobs idle most of the day, dev environments idle nights and weekends, memory-heavy VMs, saturated VMs, growing disks, unattached volumes and unused IPs, a cost jump (8 large ML VMs on day 20) and one genuine anomaly (a prod VM pegged at ~97% CPU with 25× network-out).</p>
          <p>A few VMs have metric gaps (agent outages) so the confidence score is exercised. The engine never sees which pattern a VM was given. It only sees the metrics.</p>
          <div className="font-semibold text-slate-900">Real-world check (Azure Public Dataset V2)</div>
          <p>Share of VMs at or below each CPU level: 2.7 M real Azure VMs (30 days, 5-min readings) next to our simulated estate. Real VMs are even more idle than ours, so our savings estimate is conservative.</p>
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-slate-500"><tr><th className="py-1">CPU ≤</th><th className="text-right">Azure avg</th><th className="text-right">Ours avg</th><th className="text-right">Azure p95</th><th className="text-right">Ours p95</th></tr></thead>
            <tbody>{AZURE_CPU_CDF.map(([x, az, azp]) => (
              <tr key={x} className="border-t border-slate-100"><td className="py-1">{x}%</td><td className="text-right tabular-nums">{az}%</td><td className="text-right tabular-nums">{share(vms, (s) => s.cpu_avg <= x)}%</td><td className="text-right tabular-nums">{azp}%</td><td className="text-right tabular-nums">{share(vms, (s) => s.cpu_p95 <= x)}%</td></tr>
            ))}</tbody>
          </table>
          <p className="text-xs text-slate-500">Source: <a className="underline" href="https://github.com/Azure/AzurePublicDataset/blob/master/AzurePublicDatasetV2.md" target="_blank" rel="noreferrer">Azure Public Dataset V2</a>, azure2019_data_cpu.txt. Azure&apos;s p95 is of the per-5-minute maximum, so it reads slightly higher than ours. Azure has CPU only (no memory, disk or network), which is why it benchmarks the simulation rather than replacing it.</p>
          <div className="font-semibold text-slate-900">Simplifications</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>No reserved-instance / committed-use discounts.</li>
            <li>Same prices in every region; no inter-region transfer pricing.</li>
            <li>No autoscaling groups; each VM is sized individually.</li>
            <li>Monthly bill history is reconstructed from each resource&apos;s launch date (today&apos;s monthly cost, billed from the day it was created). The launch dates are simulated.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
