"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle, BarChart3, BookOpen, Cloud, FileText, FlaskConical, Gauge, Leaf, ListChecks, Menu, Server, TrendingUp, X,
} from "lucide-react";
import { useApp } from "@/app/providers";
import { totals } from "@/lib/engine";
import { cls, inrShort } from "@/lib/format";
import type { Role } from "@/lib/types";

const NAV = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/recommendations", label: "Recommendations", icon: ListChecks },
  { href: "/savings", label: "Before vs After", icon: BarChart3 },
  { href: "/resources", label: "Resources", icon: Server },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/whatif", label: "What-if Simulator", icon: FlaskConical },
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
  { href: "/sustainability", label: "Sustainability", icon: Leaf },
  { href: "/report", label: "Report & Export", icon: FileText },
  { href: "/assumptions", label: "Assumptions", icon: BookOpen },
];

const ROLES: { id: Role; label: string }[] = [
  { id: "engineer", label: "Engineer" },
  { id: "finance", label: "Finance" },
  { id: "leadership", label: "Leadership" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { data, accepted, role, setRole } = useApp();
  const [open, setOpen] = useState(false);
  const t = data ? totals(data.resources, data.recs, accepted) : null;
  const critical = data?.alerts.filter((a) => a.severity === "critical").length ?? 0;

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={cls("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200")}>
            <Icon size={16} />
            <span className="flex-1">{label}</span>
            {href === "/alerts" && critical > 0 && (
              <span className="chip bg-red-500/90 text-white">{critical}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* sidebar */}
      <aside className="no-print hidden w-60 shrink-0 flex-col gap-6 bg-ink px-3 py-5 md:flex md:sticky md:top-0 md:h-screen">
        <Brand />
        {nav}
        <div className="mt-auto rounded-lg bg-white/5 p-3 text-xs text-slate-400">
          Simulated estate · {data?.summary.n_vms ?? "…"} VMs · 30 days · 5-min metrics.
          All prices illustrative, see <Link href="/assumptions" className="text-slate-200 underline">Assumptions</Link>.
        </div>
      </aside>

      {/* mobile header */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 md:hidden">
        <Brand />
        <button aria-label="Menu" onClick={() => setOpen(!open)} className="text-slate-200">
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && <div className="no-print bg-ink px-3 pb-4 md:hidden">{nav}</div>}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 hidden items-center gap-4 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur md:flex">
          {t && (
            <div className="flex items-center gap-5 text-sm">
              <span className="text-slate-500">Current <b className="text-slate-800">{inrShort(t.before)}</b>/mo</span>
              <span className="text-slate-400">→</span>
              <span className="text-slate-500">After accepted <b className="text-slate-800">{inrShort(t.after)}</b>/mo</span>
              <span className="chip bg-save-50 text-save-700">saving {inrShort(t.saving)} ({((t.saving / t.before) * 100).toFixed(1)}%)</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {ROLES.map((r) => (
              <button key={r.id} onClick={() => setRole(r.id)}
                className={cls("rounded-md px-3 py-1", role === r.id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}>
                {r.label}
              </button>
            ))}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2 text-white">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600"><Cloud size={18} /></span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">SmartCloud</span>
        <span className="block text-[11px] text-slate-400">Optimizer</span>
      </span>
    </Link>
  );
}
