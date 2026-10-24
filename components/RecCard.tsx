"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { useApp } from "@/app/providers";
import { ACTION_LABEL, cls, inr } from "@/lib/format";
import type { Recommendation, Role } from "@/lib/types";
import { ConfidenceBar, EnvPill, RiskPill } from "./ui";

/** Rule-based explanation, used when the AI route is unavailable. */
export function templateExplain(r: Recommendation, role: Role) {
  const money = r.saving > 0 ? `saves ${inr(r.saving)} per month` : r.saving < 0 ? `costs ${inr(-r.saving)} more per month` : "has no cost impact";
  if (role === "finance")
    return `${r.resource_name} (${r.team} team) ${money}. ${r.reason} Risk is rated ${r.risk.toLowerCase()} and our confidence in the data is ${r.confidence}%.`;
  if (role === "leadership")
    return `${r.title} on ${r.resource_name}: ${money}. ${r.risk === "LOW" ? "Safe to approve." : "Needs the owning team's sign-off."}`;
  return `${r.reason} ${r.peak_check ? `Peak check: p99 CPU ${r.peak_check.cpu_p99_before}% now → ${r.peak_check.cpu_p99_after}% after.` : ""} Confidence ${r.confidence}% (${r.confidence_notes.join("; ")}).`;
}

export function RecCard({ r, compact = false }: { r: Recommendation; compact?: boolean }) {
  const { accepted, setDecision, role } = useApp();
  const [maths, setMaths] = useState(false);
  const [explain, setExplain] = useState<{ text: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const on = !!accepted[r.id];
  const informational = r.action === "keep" || r.action === "investigate";

  async function doExplain() {
    setLoading(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rec: r, role }),
      });
      const j = await res.json();
      if (!res.ok || !j.text) throw new Error(j.error || "unavailable");
      setExplain({ text: j.text, source: "AI (Claude), grounded on the numbers above" });
    } catch {
      setExplain({ text: templateExplain(r, role), source: "rule-based explanation" });
    } finally {
      setLoading(false);
    }
  }

  const tone = r.action === "keep" ? "border-l-emerald-500" : r.action === "investigate" ? "border-l-red-500"
    : r.action === "upsize" ? "border-l-amber-500" : on ? "border-l-brand-600" : "border-l-slate-200";

  return (
    <div className={cls("card border-l-4 p-4", tone, !on && !informational && "opacity-80")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="chip bg-slate-100 text-slate-600">{ACTION_LABEL[r.action]}</span>
            <EnvPill env={r.env} />
            <span className="text-slate-400">{r.region} · {r.team}</span>
          </div>
          <div className="mt-1.5 font-semibold text-slate-900">
            {r.resource_type === "vm" ? (
              <Link href={`/resources/${r.resource_id}`} className="hover:underline">{r.resource_name}</Link>
            ) : r.resource_name}
            <span className="font-normal text-slate-500"> · {r.title}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
        </div>
        <div className="text-right">
          <div className={cls("text-lg font-semibold tabular-nums", r.saving > 0 ? "text-save-600" : r.saving < 0 ? "text-amber-600" : "text-slate-400")}>
            {r.saving > 0 ? `−${inr(r.saving)}` : r.saving < 0 ? `+${inr(-r.saving)}` : "₹0"}
          </div>
          <div className="text-xs text-slate-400">per month</div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <RiskPill risk={r.risk} />
            <span className="flex items-center gap-1.5 text-slate-500">Confidence <ConfidenceBar value={r.confidence} /></span>
            {r.peak_check && (
              <span className={cls("flex items-center gap-1", r.peak_check.safe ? "text-emerald-700" : "text-red-700")}>
                {r.peak_check.safe ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                Peak check: p99 {r.peak_check.cpu_p99_before.toFixed(0)}% → {r.peak_check.cpu_p99_after.toFixed(0)}%
                {r.peak_check.avg_based_plan && ` if shrunk to ${r.peak_check.avg_based_plan}`}
              </span>
            )}
            {r.current_plan && r.target_plan && r.current_plan !== r.target_plan && (
              <span className="mono text-slate-500">{r.current_plan} → {r.target_plan}</span>
            )}
          </div>

          {maths && (
            <div className="mt-3 rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
              {r.maths.map((m, i) => <div key={i} className="mono">{m}</div>)}
              <div className="mt-2 text-slate-400">Confidence: {r.confidence_notes.join(" · ")}</div>
            </div>
          )}
          {explain && (
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-slate-700">
              {explain.text}
              <div className="mt-1 text-[11px] text-slate-400">{explain.source} · view: {role}</div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-ghost" onClick={() => setMaths(!maths)}>
              {maths ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Show the maths
            </button>
            <button className="btn-ghost" onClick={doExplain} disabled={loading}>
              <Sparkles size={14} /> {loading ? "Explaining…" : "Explain"}
            </button>
            {!informational && (
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => setDecision(r.id, true)}
                  className={cls("btn", on ? "bg-save-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                  <Check size={14} /> {on ? "Accepted" : "Accept"}
                </button>
                <button onClick={() => setDecision(r.id, false)}
                  className={cls("btn", !on ? "bg-slate-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                  <X size={14} /> {!on ? "Rejected" : "Reject"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
