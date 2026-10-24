"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { ResponsiveContainer } from "recharts";
import { cls } from "@/lib/format";

type Render = (expanded: boolean) => React.ReactElement;

/** A chart that opens in a large popup when clicked. In the popup, `render(true)` is called so the
 *  chart can add a <Brush> (zoom slider) and bigger labels. */
export function ChartCard({ title, sub, height = 192, render, actions, footer, bare = false, className }: {
  title: string; sub?: React.ReactNode; height?: number; render: Render;
  actions?: React.ReactNode; footer?: React.ReactNode; bare?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <div role="button" tabIndex={0} aria-label={`Open ${title} full screen`} title="Click to open and zoom"
      onClick={() => setOpen(true)} onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      className="group relative cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" style={{ height }}>
      <ResponsiveContainer>{render(false)}</ResponsiveContainer>
      <span className="pointer-events-none absolute right-1 top-1 flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 opacity-0 shadow-sm ring-1 ring-slate-200 transition-opacity group-hover:opacity-100">
        <Maximize2 size={11} /> Click to zoom
      </span>
    </div>
  );

  return (
    <>
      {bare ? <div className={className}>{body}</div> : (
        <div className={cls("card card-pad", className)}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
              {sub && <p className="text-xs text-slate-500">{sub}</p>}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button onClick={() => setOpen(true)} aria-label="Expand chart"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><Maximize2 size={15} /></button>
            </div>
          </div>
          {body}
          {footer}
        </div>
      )}
      {open && <ChartModal title={title} sub={sub} actions={actions} render={render} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChartModal({ title, sub, actions, render, onClose }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; render: Render; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm animate-[fadeIn_.15s_ease-out] md:p-8" onMouseDown={onClose}>
      <div className="flex h-full max-h-[760px] w-full max-w-6xl flex-col rounded-2xl bg-white p-4 shadow-2xl animate-[popIn_.2s_cubic-bezier(.2,.8,.2,1)] md:p-6"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {sub && <p className="text-sm text-slate-500">{sub}</p>}
            <p className="mt-1 text-xs text-slate-400">Drag the handles on the slider under the chart to zoom into a range. Hover for exact values. Esc to close.</p>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
          </div>
        </div>
        <div className="mt-4 min-h-0 flex-1">
          <ResponsiveContainer>{render(true)}</ResponsiveContainer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
