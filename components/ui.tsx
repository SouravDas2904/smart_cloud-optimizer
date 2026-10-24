"use client";

import { useApp } from "@/app/providers";
import { cls } from "@/lib/format";
import type { Risk } from "@/lib/types";
import { CountUp } from "./motion";

export function Loading() {
  const { error } = useApp();
  return (
    <div className="grid h-64 place-items-center text-sm text-slate-500">
      {error ? <span className="text-red-600">Could not load data: {error}</span> : "Loading analysis…"}
    </div>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({ label, value, sub, tone = "default", icon, count, fmt }: {
  label: string; value?: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "save" | "warn" | "bad"; icon?: React.ReactNode;
  /** when given, the number counts up on first view */ count?: number; fmt?: (n: number) => string;
}) {
  const color = { default: "text-slate-900", save: "text-save-600", warn: "text-amber-600", bad: "text-red-600" }[tone];
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={cls("mt-1.5 text-2xl font-semibold tabular-nums", color)}>{count !== undefined && fmt ? <CountUp value={count} format={fmt} /> : value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function RiskPill({ risk }: { risk: Risk }) {
  const c = { LOW: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", MEDIUM: "bg-amber-50 text-amber-700 ring-amber-600/20", HIGH: "bg-red-50 text-red-700 ring-red-600/20" }[risk];
  return <span className={cls("chip ring-1 ring-inset", c)}>{risk} risk</span>;
}

export function EnvPill({ env }: { env: string }) {
  const c = { prod: "bg-blue-50 text-blue-700", staging: "bg-violet-50 text-violet-700", dev: "bg-teal-50 text-teal-700" }[env] ?? "bg-slate-100";
  return <span className={cls("chip", c)}>{env}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const c = value >= 80 ? "bg-emerald-500" : value >= 55 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={cls("h-full rounded-full", c)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{value}%</span>
    </div>
  );
}

export function MultiSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cls("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-500")}>
            {o}
          </button>
        );
      })}
    </div>
  );
}
