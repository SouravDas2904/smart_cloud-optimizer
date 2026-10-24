"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { useApp } from "@/app/providers";
import { totals } from "@/lib/engine";
import { cls, inrShort } from "@/lib/format";
import type { Role } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { CountUp } from "./motion";
import { NAV } from "@/lib/nav";



const ROLES: { id: Role; label: string }[] = [
  { id: "engineer", label: "Engineer" },
  { id: "finance", label: "Finance" },
  { id: "leadership", label: "Leadership" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data, accepted, role, setRole } = useApp();
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

  const crumb = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)))?.label ?? "";

  const nav = (
    <nav className="flex flex-col">
      {NAV.map(({ href, label }, i) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={cls("group relative flex items-center gap-3 rounded-md px-3 py-[7px] text-[13px] transition-colors",
              active ? "bg-slate-50 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
            <span className={cls("absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-all",
              active ? "bg-brand-500 opacity-100" : "bg-slate-400 opacity-0 group-hover:opacity-60")} />
            <span className={cls("font-mono text-[10px] tabular-nums", active ? "text-brand-500" : "text-slate-400")}>{String(i + 1).padStart(2, "0")}</span>
            <span className="flex-1">{label}</span>
            {href === "/alerts" && critical > 0 && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-red-500">
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
        <div className="mt-auto space-y-2 rounded-md border border-slate-200 p-3 font-mono text-[10.5px] uppercase leading-relaxed tracking-wider text-slate-500">
          <div className="flex items-center gap-2 text-slate-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            Engine ready
          </div>
          <div>24 Sep → 23 Oct · 5 min</div>
          <div>{data?.summary.n_vms ?? "…"} VMs · simulated estate</div>
          <Link href="/assumptions" className="block normal-case tracking-normal text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-slate-700">Prices are illustrative</Link>
        </div>
      </aside>

      {/* mobile header */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-ink/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <div className="flex items-center gap-3 text-slate-700">
          <button aria-label="Search" onClick={() => setPalette(true)}><Search size={18} /></button>
          <button aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {open && (
        <div className="no-print border-b border-slate-200 bg-ink px-3 pb-4 md:hidden">
          {nav}
          <RoleSwitch role={role} setRole={setRole} className="mt-3" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 hidden h-14 items-center gap-5 border-b border-slate-200 bg-ink/80 px-6 backdrop-blur-md md:flex">
          <div className="font-mono text-xs text-slate-500">
            smartcloud <span className="text-slate-300">/</span> <span className="text-slate-800">{crumb.toLowerCase()}</span>
          </div>
          {t && (
            <div className="hidden items-center gap-3 font-mono text-xs lg:flex">
              <span className="text-slate-400">NOW</span><span className="text-slate-800">{inrShort(t.before)}</span>
              <span className="text-slate-300">→</span>
              <span className="text-slate-400">AFTER</span><span className="text-slate-800"><CountUp value={t.after} format={inrShort} ms={500} /></span>
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-500">
                saving <CountUp value={t.saving} format={inrShort} ms={500} /> ({((t.saving / t.before) * 100).toFixed(1)}%)
              </span>
            </div>
          )}
          <button onClick={() => setPalette(true)}
            className="ml-auto flex w-56 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700">
            <Search size={13} /> Jump to a VM or page
            <kbd className="ml-auto rounded border border-slate-300 px-1 font-mono text-[10px] text-slate-500">Ctrl K</kbd>
          </button>
          <RoleSwitch role={role} setRole={setRole} />
        </header>
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
        <button key={r.id} onClick={() => setRole(r.id)}
          className={cls("rounded px-2.5 py-1 transition-colors", role === r.id ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke="rgb(var(--slate-300))" />
        <path d="M8 21.5h3.2l2.6-9 3.6 13 2.8-8.5H24" fill="none" stroke="rgb(var(--brand-500))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold tracking-tight text-slate-900">SmartCloud</span>
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.18em] text-slate-500">Optimizer</span>
      </span>
    </Link>
  );
}
