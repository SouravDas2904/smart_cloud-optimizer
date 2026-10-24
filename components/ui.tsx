"use client";

import { useApp } from "@/app/providers";
import { cls } from "@/lib/format";
import type { Risk } from "@/lib/types";
import { CountUp } from "./motion";

export function Loading() {
  const { error } = useApp();
  return (
    <div className="grid h-64 place-items-center">
      {error ? <span className="text-sm text-red-600">Could not load data: {error}</span> : (
        <div className="w-48">
          <div className="label mb-2 text-center">Loading analysis</div>
          <div className="relative h-px overflow-hidden bg-slate-200"><div className="absolute inset-y-0 w-1/4 animate-scan bg-brand-500" /></div>
        </div>
      )}
    </div>
  );
}

export function PageTitle({ title, sub, right, kicker }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; kicker?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <div className="label mb-2 text-brand-500">{kicker}</div>}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900 md:text-[30px]">{title}</h1>
        {sub && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const TONE = { default: "text-slate-900", save: "text-save-600", warn: "text-amber-600", bad: "text-red-600" };

export function Kpi({ label, value, sub, tone = "default", icon, count, fmt }: {
  label: string; value?: React.ReactNode; sub?: React.ReactNode; tone?: keyof typeof TONE; icon?: React.ReactNode;
  /** when set, the number counts up on first view */ count?: number; fmt?: (n: number) => string;
}) {
  return (
    <div className="card card-pad overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={cls("mt-3 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums", TONE[tone])}>
        {count !== undefined && fmt ? <CountUp value={count} format={fmt} /> : value}
      </div>
      {sub && <div className="mt-2 text-xs leading-relaxed text-slate-500">{sub}</div>}
    </div>
  );
}

export function RiskPill({ risk }: { risk: Risk }) {
  const c = { LOW: "bg-emerald-50 text-emerald-700", MEDIUM: "bg-amber-50 text-amber-700", HIGH: "bg-red-50 text-red-700" }[risk];
  return <span className={cls("chip", c)}>{risk} risk</span>;
}

export function EnvPill({ env }: { env: string }) {
  const c = { prod: "bg-slate-100 text-slate-900", staging: "bg-blue-50 text-blue-700", dev: "bg-teal-50 text-teal-700" }[env] ?? "bg-slate-100";
  return <span className={cls("chip", c)}>{env}</span>;
}

/** Ten segments, like a level meter. */
export function ConfidenceBar({ value }: { value: number }) {
  const c = value >= 80 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : "bg-red-500";
  const lit = Math.round(value / 10);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => <span key={i} className={cls("h-2.5 w-[4px] rounded-[1px]", i < lit ? c : "bg-slate-200")} />)}
      </div>
      <span className="font-mono text-[12px] tabular-nums text-slate-500">{value}%</span>
    </div>
  );
}

/**
 * Filter chips. With nothing narrowed down every option counts and the "All" chip is lit.
 * The first click on an option shows ONLY that option; further clicks add or remove more.
 * Removing the last selected option (or clicking "All") goes back to everything.
 */
export function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const all = options.every((o) => value.includes(o));
  const pick = (o: string) => {
    if (all) return onChange([o]);
    const next = value.includes(o) ? value.filter((x) => x !== o) : [...value, o];
    onChange(next.length ? next : options);
  };
  const chip = "rounded-md border px-2.5 py-0.5 text-xs transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label mr-1">{label}</span>
      <button onClick={() => onChange(options)} aria-pressed={all}
        className={cls(chip, all ? "border-brand-500 bg-brand-500 font-medium text-ink" : "border-slate-200 text-slate-500 hover:text-slate-800")}>
        All
      </button>
      {options.map((o) => {
        const on = !all && value.includes(o);
        return (
          <button key={o} onClick={() => pick(o)} aria-pressed={on}
            className={cls(chip, on ? "border-brand-500 bg-brand-500 font-medium text-ink" : "border-slate-200 bg-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")}>
            {o}
          </button>
        );
      })}
    </div>
  );
}
