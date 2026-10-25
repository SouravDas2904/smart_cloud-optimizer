"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Database, Menu, Search, Upload, X } from "lucide-react";
import { useApp } from "@/app/providers";
import { totals } from "@/lib/engine";
import { cls, inrShort } from "@/lib/format";
import type { Role } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { CountUp } from "./motion";
import { NAV } from "@/lib/nav";
import { showDemo } from "@/lib/dataset";

/** "24 Sep → 23 Oct" from the summary's window */
function windowLabel(start: string | undefined, days: number | undefined) {
  if (!start || !days) return "…";
  const d0 = new Date(start);
  const d1 = new Date(d0.getTime() + (days - 1) * 86400000);
  const f = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  return `${f(d0)} → ${f(d1)}`;
}

// The role changes what the Overview and the recommendation cards emphasise.
const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "engineer", label: "Engineer", hint: "Full technical detail: peak checks, maths, plans" },
  { id: "finance", label: "Finance", hint: "Money view: chargeback by team, annual savings, budget gap" },
  { id: "leadership", label: "Leadership", hint: "One-minute summary and the decisions that need you" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data, accepted, role, setRole, source, upload, reload } = useApp();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const t = data ? totals(data.resources, data.recs, accepted) : null;
  const critical = data?.alerts.filter((a) => a.severity === "critical").length ?? 0;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea,select")) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const backToDemo = async () => { await showDemo(); reload(); };
  const s = data?.summary;
  const steps = s?.data_source?.input_step_min ?? [5];
  const stepLabel = steps.length > 1 ? `${steps[0]}–${steps[steps.length - 1]} min` : `${steps[0]} min`;

  // The upload page is its own focused screen, outside the sidebar layout.
  if (path.startsWith("/upload")) {
    return (
      <div className="min-h-screen">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-ink/80 px-4 backdrop-blur-md md:px-6">
          <Brand />
          <Link href="/" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900">
            ← Back to dashboard
          </Link>
        </header>
        <main className="page-enter mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">{children}</main>
      </div>
    );
  }

  const crumb = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)))?.label ?? "";

  const nav = (
    <nav className="flex flex-col">
      {NAV.map(({ href, label }, i) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={cls("group relative flex items-center gap-3 rounded-md px-3 py-[7px] text-[14px] transition-colors",
              active ? "bg-slate-50 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
            <span className={cls("absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-all",
              active ? "bg-brand-500 opacity-100" : "bg-slate-400 opacity-0 group-hover:opacity-60")} />
            <span className={cls("font-mono text-[11px] tabular-nums", active ? "text-brand-500" : "text-slate-400")}>{String(i + 1).padStart(2, "0")}</span>
            <span className="flex-1">{label}</span>
            {href === "/alerts" && critical > 0 && (
              <span className="flex items-center gap-1 font-mono text-[11px] text-red-500">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-red-500" />{critical}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="no-print hidden w-56 shrink-0 flex-col gap-7 border-r border-slate-200 px-3 py-5 md:sticky md:top-0 md:flex md:h-screen">
        <Brand />
        <div>
          <div className="label mb-2 px-3">Workspace</div>
          {nav}
        </div>
        <div className="mt-auto space-y-2 rounded-md border border-slate-200 p-3 font-mono text-[11.5px] uppercase leading-relaxed tracking-wider text-slate-500">
          <div className="flex items-center gap-2 text-slate-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            Engine ready
          </div>
          <div>{windowLabel(s?.window_start, s?.window_days)} · {stepLabel}</div>
          <div>{s?.n_vms ?? "…"} VMs · {source === "upload" ? "your data" : "simulated estate"}</div>
          {source === "upload" ? (
            <button onClick={backToDemo} className="block normal-case tracking-normal text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-slate-700">Back to demo data</button>
          ) : (
            <Link href="/assumptions" className="block normal-case tracking-normal text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-slate-700">Prices are illustrative</Link>
          )}
        </div>
      </aside>

      {/* mobile header */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-ink/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <div className="flex items-center gap-3 text-slate-700">
          <Link href="/upload" aria-label="Upload real data" className="text-brand-500"><Upload size={18} /></Link>
          <button aria-label="Search" onClick={() => setPalette(true)}><Search size={18} /></button>
          <button aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {open && (
        <div className="no-print border-b border-slate-200 bg-ink px-3 pb-4 md:hidden">
          {nav}
          <RoleSwitch role={role} setRole={setRole} className="mt-3" />
          <p className="mt-2 px-1 text-xs text-slate-500">{ROLES.find((r) => r.id === role)?.hint}</p>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-slate-200 bg-ink/80 px-6 backdrop-blur-md md:flex">
          <div className="font-mono text-xs text-slate-500">
            smartcloud <span className="text-slate-300">/</span> <span className="text-slate-800">{crumb.toLowerCase()}</span>
          </div>
          {t && (
            <div className="hidden items-center gap-3 whitespace-nowrap font-mono text-xs lg:flex">
              <span className="text-slate-400">NOW</span><span className="text-slate-800">{inrShort(t.before)}</span>
              <span className="text-slate-300">→</span>
              <span className="text-slate-400">AFTER</span><span className="text-slate-800"><CountUp value={t.after} format={inrShort} ms={500} /></span>
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-500">
                saving <CountUp value={t.saving} format={inrShort} ms={500} /> ({((t.saving / t.before) * 100).toFixed(1)}%)
              </span>
            </div>
          )}
          <Link href="/upload"
            className="upload-cta ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-600 transition-all hover:border-brand-500/80 hover:bg-brand-500/15 hover:shadow-[0_0_18px_-6px_rgb(var(--brand-500)/0.8)]">
            <Upload size={13} /> Upload real data
          </Link>
          <button onClick={() => setPalette(true)}
            className="flex w-40 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700">
            <Search size={13} /> <span className="truncate">Jump to a VM</span>
            <kbd className="ml-auto rounded border border-slate-300 px-1 font-mono text-[11px] text-slate-500">Ctrl K</kbd>
          </button>
          <span className="hidden max-w-[200px] text-right text-xs leading-tight text-slate-500 2xl:block">{ROLES.find((r) => r.id === role)?.hint}</span>
          <RoleSwitch role={role} setRole={setRole} />
        </header>
        {source === "upload" && (
          <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-brand-500/25 bg-brand-500/[0.07] px-4 py-2 text-xs text-slate-700 md:px-6">
            <Database size={13} className="text-brand-500" />
            <span>You are viewing <b className="text-slate-900">your uploaded data</b>{upload ? ` (${upload.name})` : ""}: {s?.n_vms ?? "…"} VMs, {s?.window_days ?? "…"} days, analysed in this browser.</span>
            <Link href="/upload" className="text-brand-600 underline underline-offset-2">Upload other files</Link>
            <button onClick={backToDemo} className="text-slate-500 underline underline-offset-2 hover:text-slate-800">Back to demo data</button>
          </div>
        )}
        <main key={path} className="page-enter mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-7">{children}</main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function RoleSwitch({ role, setRole, className }: { role: Role; setRole: (r: Role) => void; className?: string }) {
  return (
    <div className={cls("flex items-center rounded-md border border-slate-200 p-0.5 text-xs", className)}>
      {ROLES.map((r) => (
        <button key={r.id} onClick={() => setRole(r.id)} title={r.hint}
          className={cls("rounded px-2.5 py-1 transition-colors", role === r.id ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

// Logo: a brain inside a cloud. On hover the cloud and brain glow and the brain throws a few sparks (globals.css .brand-*).
function Brand() {
  return (
    <Link href="/" aria-label="SmartCloud Optimizer: go to Overview" title="Go to Overview"
      className="brand group flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-slate-100/60">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-brand-500/35 bg-gradient-to-br from-brand-100 to-ink transition-all duration-300 group-hover:border-brand-500/80 group-hover:shadow-[0_0_22px_-4px_rgb(var(--brand-500)/0.75)]">
        <svg width="30" height="30" viewBox="0 -3 32 32" aria-hidden className="overflow-visible">
          <path className="brand-cloud" d="M10 24H23A5 5 0 0 0 23.6 14.05A7.5 7.5 0 0 0 9.3 13.2A5.4 5.4 0 0 0 10 24Z"
            fill="rgb(var(--brand-500) / 0.08)" stroke="rgb(var(--brand-500))" strokeWidth="1.6" strokeLinejoin="round" />
          <g className="brand-brain" transform="translate(16.5 16.6) scale(1.55) translate(-16.5 -17.9)"
            fill="none" stroke="rgb(var(--brand-500))" strokeWidth="0.82" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.4 15.4c-.8-.8-2.4-.6-2.7.5-1 .1-1.6 1.2-1.1 2.1-.6.8-.1 2 1 2.1.3.9 1.6 1.2 2.8.5Z" />
            <path d="M16.6 15.4c.8-.8 2.4-.6 2.7.5 1 .1 1.6 1.2 1.1 2.1.6.8.1 2-1 2.1-.3.9-1.6 1.2-2.8.5Z" />
            <path d="M14.1 17.3c.7-.1 1.2.4 1.2 1M18.9 17.3c-.7-.1-1.2.4-1.2 1M13.7 19.6c.4-.4 1.1-.4 1.6 0M19.3 19.6c-.4-.4-1.1-.4-1.6 0" />
          </g>
          <g stroke="rgb(var(--brand-700))" strokeWidth="1.3" strokeLinecap="round">
            <path className="brand-spark" d="M16.5 3.6V1" />
            <path className="brand-spark" d="M9.6 6.4L7.9 4.6" />
            <path className="brand-spark" d="M23.4 6.4l1.7-1.8" />
            <circle className="brand-spark" cx="16.5" cy="16.4" r="0.9" fill="rgb(var(--brand-700))" stroke="none" />
          </g>
        </svg>
      </span>
      <span className="leading-none">
        <span className="block text-[15.5px] font-semibold tracking-tight text-slate-900">
          Smart<span className="text-brand-500">Cloud</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500 transition-colors group-hover:text-slate-700">
          <span className="h-px w-3 bg-brand-500/70" />Optimizer
        </span>
      </span>
    </Link>
  );
}
