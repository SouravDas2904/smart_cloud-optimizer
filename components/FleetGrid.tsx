"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ACTION_LABEL, cls, inr } from "@/lib/format";
import type { Recommendation, Resource } from "@/lib/types";

// Primary action per VM decides the colour; the fill height is the VM's p99 CPU.
const KINDS = [
  { id: "resize", label: "Resize", color: "#c6f432" },
  { id: "schedule", label: "Schedule", color: "#4fd1c5" },
  { id: "stop", label: "Idle", color: "#8c8c94" },
  { id: "upsize", label: "Upsize", color: "#ff9f1c" },
  { id: "keep", label: "Peak protected", color: "#e8e8ea" },
  { id: "investigate", label: "Anomaly", color: "#ff5a4e" },
  { id: "none", label: "Right-sized", color: "#3a3a40" },
] as const;
type Kind = (typeof KINDS)[number]["id"];
const PRIORITY: Kind[] = ["investigate", "upsize", "stop", "resize", "keep", "schedule"];

type Cell = { r: Resource; kind: Kind; sched: boolean; saving: number; recs: Recommendation[] };

export function FleetGrid({ vms, recs }: { vms: Resource[]; recs: Recommendation[] }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const cellEls = useRef<(HTMLButtonElement | null)[]>([]);
  const [hover, setHover] = useState<Cell | null>(null);
  const [only, setOnly] = useState<Kind | null>(null);

  const cells = useMemo<Cell[]>(() => {
    const by: Record<string, Recommendation[]> = {};
    recs.forEach((x) => (by[x.resource_id] ??= []).push(x));
    const envOrder = { prod: 0, staging: 1, dev: 2 } as Record<string, number>;
    return vms.map((r) => {
      const rs = by[r.id] ?? [];
      const acts: string[] = rs.map((x) => (x.action === "review" ? "stop" : x.action));
      const kind = (PRIORITY.find((k) => acts.includes(k)) ?? "none") as Kind;
      return { r, kind, sched: acts.includes("schedule"), recs: rs, saving: rs.reduce((s, x) => s + Math.max(0, x.saving), 0) };
    }).sort((a, b) => envOrder[a.r.env] - envOrder[b.r.env] || (b.r.stats?.cpu_p99 ?? 0) - (a.r.stats?.cpu_p99 ?? 0));
  }, [vms, recs]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    cells.forEach((x) => {
      c[x.kind] = (c[x.kind] ?? 0) + 1;
      if (x.sched) c.schedule = (c.schedule ?? 0) + 1;   // schedules stack on a resize, so they get a corner dot
    });
    return c;
  }, [cells]);

  // magnifying lens: cells near the pointer grow, without re-rendering React
  function lens(e: React.PointerEvent) {
    for (const el of cellEls.current) {
      if (!el) continue;
      const b = el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
      const k = Math.max(0, 1 - d / 90);
      el.style.transform = `scale(${1 + 0.45 * k * k})`;
      el.style.zIndex = k > 0.6 ? "2" : "";
    }
  }
  function reset() {
    cellEls.current.forEach((el) => { if (el) { el.style.transform = ""; el.style.zIndex = ""; } });
    setHover(null);
  }

  const color = (k: Kind) => KINDS.find((x) => x.id === k)!.color;
  const show = hover ?? cells.find((c) => c.r.name === "prod-reports-01") ?? cells[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div>
        <div ref={wrap} onPointerMove={lens} onPointerLeave={reset}
          className="grid touch-none grid-cols-12 gap-[5px] sm:grid-cols-[repeat(16,minmax(0,1fr))]">
          {cells.map((c, i) => {
            const p99 = Math.min(100, c.r.stats?.cpu_p99 ?? 0);
            const dim = only && (only === "schedule" ? !c.sched : c.kind !== only);
            return (
              <button key={c.r.id} ref={(el) => { cellEls.current[i] = el; }}
                onPointerEnter={() => setHover(c)} onFocus={() => setHover(c)} onClick={() => router.push(`/resources/${c.r.id}`)}
                aria-label={`${c.r.name}: ${ACTION_LABEL[c.kind] ?? "no action"}, p99 CPU ${p99.toFixed(0)}%`}
                className={cls("relative aspect-square overflow-hidden rounded-[3px] border transition-[transform,opacity] duration-150 ease-out",
                  hover?.r.id === c.r.id ? "border-slate-900" : "border-slate-200", dim && "opacity-15")}
                style={{ background: "rgb(var(--slate-50))" }}>
                <span className="absolute inset-x-0 bottom-0" style={{ height: `${Math.max(8, p99)}%`, background: color(c.kind), opacity: c.kind === "none" ? 1 : 0.9 }} />
                {c.sched && <span className="absolute right-[2px] top-[2px] h-[5px] w-[5px] rounded-full" style={{ background: color("schedule") }} />}
                {c.kind === "investigate" && <span className="absolute inset-0 animate-blink bg-red-500/40" />}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {KINDS.map((k) => (
            <button key={k.id} onClick={() => setOnly(only === k.id ? null : k.id)}
              className={cls("flex items-center gap-1.5 font-mono text-[11.5px] uppercase tracking-wider transition-opacity",
                only && only !== k.id ? "opacity-40" : "text-slate-600")}>
              <span className="h-2 w-2 rounded-[2px]" style={{ background: k.color }} />
              {k.label} <span className="text-slate-400">{counts[k.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* readout for the hovered VM */}
      {show && (
        <div className="rounded-md border border-slate-200 bg-ink p-3 font-mono text-[12px] leading-relaxed">
          <div className="label mb-1.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color(show.kind) }} />
            {hover ? "Selected VM" : "Hover or tap a cell"}
          </div>
          <div className="truncate text-[14px] text-slate-900">{show.r.name}</div>
          <div className="text-slate-500">{show.r.plan} · {show.r.env} · {show.r.region}</div>
          <div className="mt-2 space-y-0.5">
            <Row k="avg CPU" v={`${show.r.stats?.cpu_avg.toFixed(1)}%`} />
            <Row k="p99 CPU" v={`${show.r.stats?.cpu_p99.toFixed(1)}%`} />
            <Row k="p99 mem" v={`${show.r.stats?.mem_p99.toFixed(1)}%`} />
            <Row k="cost/mo" v={inr(show.r.cost.total)} />
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2">
            {show.recs.length === 0 ? <span className="text-slate-500">No action: right-sized.</span> : show.recs.map((x) => (
              <div key={x.id} className="flex justify-between gap-2">
                <span className="text-slate-700">{ACTION_LABEL[x.action]}</span>
                <span className={x.saving > 0 ? "text-save-600" : x.saving < 0 ? "text-amber-600" : "text-slate-500"}>
                  {x.saving > 0 ? `−${inr(x.saving)}` : x.saving < 0 ? `+${inr(-x.saving)}` : "₹0"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-slate-400">Click a cell to open it · dot = also schedulable</div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-slate-500">{k}</span><span className="tabular-nums text-slate-800">{v}</span></div>;
}
