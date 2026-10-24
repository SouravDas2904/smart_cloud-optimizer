"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useApp } from "@/app/providers";
import { ACTION_LABEL, cls } from "@/lib/format";
import { NAV } from "@/lib/nav";

type Item = { id: string; label: string; hint: string; href: string; group: "Pages" | "VMs" };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const action: Record<string, string> = {};
    data?.recs.forEach((r) => { if (!action[r.resource_id]) action[r.resource_id] = ACTION_LABEL[r.action]; });
    const pages = NAV.map((n) => ({ id: n.href, label: n.label, hint: "page", href: n.href, group: "Pages" as const }));
    const vms = (data?.resources ?? []).filter((r) => r.type === "vm").map((r) => ({
      id: r.id, label: r.name, hint: `${r.plan} · ${r.env} · ${action[r.id] ?? "no action"}`, href: `/resources/${r.id}`, group: "VMs" as const,
    }));
    return [...pages, ...vms];
  }, [data]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.hint.toLowerCase().includes(s)) : items.filter((i) => i.group === "Pages");
    return hits.slice(0, 40);
  }, [q, items]);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;
  const go = (i: Item | undefined) => { if (!i) return; router.push(i.href); onClose(); };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-[0_24px_80px_rgb(0_0_0/.7)] animate-rise"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <Search size={15} className="text-slate-500" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VMs, plans, actions or pages…"
            className="h-12 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") go(shown[sel]);
              if (e.key === "Escape") onClose();
            }} />
          <kbd className="rounded border border-slate-300 px-1 font-mono text-[11px] text-slate-500">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Nothing matches “{q}”.</li>}
          {shown.map((i, n) => (
            <li key={i.id}>
              {(n === 0 || shown[n - 1].group !== i.group) && <div className="label px-3 pb-1 pt-2">{i.group}</div>}
              <button onMouseEnter={() => setSel(n)} onClick={() => go(i)}
                className={cls("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", n === sel ? "bg-slate-100 text-slate-900" : "text-slate-700")}>
                <span className={cls("font-mono", i.group === "VMs" && "text-[14px]")}>{i.label}</span>
                <span className="truncate font-mono text-[12px] text-slate-500">{i.group === "VMs" ? i.hint : ""}</span>
                {n === sel && <CornerDownLeft size={13} className="ml-auto shrink-0 text-slate-500" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
