"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertOctagon, ArrowRight, CheckCircle2, ChevronDown, Cpu, Download, FileSpreadsheet, Lock, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";
import { useApp } from "../providers";
import { cls } from "@/lib/format";
import { saveUpload, showDemo, switchToUpload, uploadedMeta, type UploadedMeta, type UploadedOutputs } from "@/lib/dataset";
import { CRITERIA, DEGRADE, SPECS, kindFromName, quickCheck, type Kind, type Problem, type Quick } from "@/lib/uploadSpec";
import type { Summary } from "@/lib/types";

const PYODIDE = process.env.NEXT_PUBLIC_PYODIDE_URL || "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const SAMPLE = "/samples/demo_company";

type Slot = { file: File; quick: Quick };
type Phase =
  | { kind: "idle" }
  | { kind: "running"; step: string; log: string[]; started: number }
  | { kind: "problems"; problems: Problem[] }
  | { kind: "crash"; message: string }
  | { kind: "done"; summary: Summary };

const STEPS = [
  { id: "boot", label: "Load the engine" },
  { id: "check", label: "Check every row" },
  { id: "engine", label: "Analyse" },
  { id: "save", label: "Build the dashboard" },
];

export default function UploadPage() {
  const router = useRouter();
  const { reload, source } = useApp();
  const [slots, setSlots] = useState<Partial<Record<Kind, Slot>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [saved, setSaved] = useState<UploadedMeta | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stray, setStray] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => { uploadedMeta().then(setSaved); }, [phase.kind]);
  useEffect(() => () => worker.current?.terminate(), []);

  const add = useCallback(async (kind: Kind, file: File) => {
    const quick = await quickCheck(kind, file);
    setSlots((s) => ({ ...s, [kind]: { file, quick } }));
    setPhase({ kind: "idle" });
  }, []);

  const addMany = useCallback(async (files: FileList | File[]) => {
    const wrong: string[] = [];
    for (const f of Array.from(files)) {
      const k = kindFromName(f.name);
      if (k) await add(k, f);
      else wrong.push(f.name);
    }
    setStray(wrong.length ? `Not added: ${wrong.join(", ")}. Name each file inventory.csv, metrics.csv, pricing.csv or rates.csv, or drop it on its own box below.` : null);
  }, [add]);

  const loadSample = async () => {
    setStray(null);
    for (const s of SPECS) {
      const r = await fetch(`${SAMPLE}/${s.file}`);
      if (r.ok) await add(s.kind, new File([await r.blob()], s.file, { type: "text/csv" }));
    }
  };

  const required = SPECS.filter((s) => s.required);
  const ready = required.every((s) => slots[s.kind]?.quick.ok) && Object.values(slots).every((s) => s!.quick.ok);
  const running = phase.kind === "running";
  const bad = Object.values(slots).filter((x) => !x!.quick.ok).map((x) => x!.file.name);

  const run = async () => {
    if (!ready || running) return;
    setPhase({ kind: "running", step: "boot", log: [], started: Date.now() });
    const files: Record<string, ArrayBuffer> = {};
    for (const [k, s] of Object.entries(slots)) files[k] = await s!.file.arrayBuffer();
    if (!worker.current) worker.current = new Worker("/engine-worker.js");
    const w = worker.current;
    w.onmessage = async (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") {
        setPhase((p) => {
          if (p.kind !== "running") return p;
          if (m.step === "log") {
            if (String(m.detail).startsWith("STEP ")) return { ...p, step: String(m.detail).slice(5) };
            return { ...p, log: [...p.log, String(m.detail)].slice(-6) };
          }
          return { ...p, step: m.step, log: [...p.log, m.detail].slice(-6) };
        });
      } else if (m.type === "problems") {
        setPhase({ kind: "problems", problems: m.problems });
      } else if (m.type === "crash") {
        setPhase({ kind: "crash", message: m.message });
      } else if (m.type === "done") {
        const outputs = m.outputs as UploadedOutputs;
        const name = slots.inventory!.file.name === "inventory.csv" ? "your CSV files" : slots.inventory!.file.name;
        await saveUpload(outputs, {
          name, loadedAt: new Date().toISOString(),
          files: Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, { name: s!.file.name, size: s!.file.size }])),
        });
        setPhase({ kind: "done", summary: outputs.summary as Summary });
        reload();
      }
    };
    w.postMessage({ type: "run", base: PYODIDE, files, name: "your CSV files" }, Object.values(files));
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addMany(e.dataTransfer.files); }}
      className="relative space-y-8">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 px-10 py-8 text-center">
            <Upload className="mx-auto text-brand-500" size={28} />
            <div className="mt-3 text-lg font-semibold text-slate-900">Drop your CSV files</div>
            <div className="mt-1 text-sm text-slate-500">Each file is matched by its name</div>
          </div>
        </div>
      )}

      {/* hero */}
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <div className="label mb-3 text-brand-500">Bring your own data</div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-slate-900 md:text-[40px] md:leading-[1.1]">
            Upload real data
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-500">
            Drop your company&apos;s CSV exports. The same engine that built the demo checks every file, row and column, then
            analyses them <b className="font-medium text-slate-700">right here in your browser</b>. Anything that is not exactly the
            format below is refused with the reason, so nothing wrong ever reaches the numbers.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={loadSample} className="btn-ghost"><FileSpreadsheet size={15} /> Try the sample files</button>
            <a href="#format" className="btn-ghost"><ChevronDown size={15} /> See the accepted format</a>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          <Trust icon={<Lock size={15} />} title="Never leaves this computer" text="No server and no upload: files are read by your browser only." />
          <Trust icon={<ShieldCheck size={15} />} title="Strict checks" text="Wrong, random or non-CSV files are stopped with the file, row and column." />
          <Trust icon={<Cpu size={15} />} title="Same maths as the demo" text="engine/*.py runs unchanged (Python in WebAssembly)." />
        </div>
      </section>

      {source === "upload" || saved ? (
        <CurrentData saved={saved} source={source} onDemo={async () => { await showDemo(); reload(); }}
          onUpload={async () => { if (await switchToUpload()) { reload(); router.push("/"); } }} />
      ) : null}

      {/* steps */}
      <Stepper slots={slots} phase={phase} />

      {/* file slots */}
      <section>
        {stray && <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">{stray}</div>}
        <div className="grid gap-4 md:grid-cols-2">
          {SPECS.map((s) => (
            <FileSlot key={s.kind} kind={s.kind} slot={slots[s.kind]} disabled={running}
              onFile={(f) => add(s.kind, f)}
              onClear={() => { setSlots((x) => { const n = { ...x }; delete n[s.kind]; return n; }); setPhase({ kind: "idle" }); }} />
          ))}
        </div>
      </section>

      {/* action + result */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={run} disabled={!ready || running}
            className={cls("btn px-5 py-2.5 text-[15px]", ready && !running ? "bg-brand-600 text-ink shadow-[0_0_28px_-8px_rgb(var(--brand-500)/0.9)] hover:bg-brand-700" : "cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-400")}>
            <ShieldCheck size={16} /> {running ? "Working…" : "Check & analyse"}
          </button>
          <p className="text-sm text-slate-500">
            {ready ? "All files look right. The engine will now check every row, then analyse."
              : bad.length ? <span className="text-red-600">Wrong file: {bad.join(", ")}. Please upload the correct file{bad.length > 1 ? "s" : ""} (see the red boxes above).</span>
              : `Add ${required.filter((s) => !slots[s.kind]?.quick.ok).map((s) => s.file).join(", ")} to continue.`}
          </p>
        </div>
        {phase.kind === "running" && <Progress phase={phase} />}
        {phase.kind === "problems" && <Problems problems={phase.problems} />}
        {phase.kind === "crash" && (
          <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-4 text-sm">
            <div className="font-semibold text-red-600">The engine stopped unexpectedly</div>
            <p className="mt-1 text-slate-600">Nothing was loaded. If the files are very large, try the command line instead: <span className="mono">python engine/build.py --data &lt;folder&gt;</span>.</p>
            <pre className="code mt-3 max-h-40 overflow-auto whitespace-pre-wrap">{phase.message}</pre>
          </div>
        )}
        {phase.kind === "done" && <Done s={phase.summary} onOpen={() => router.push("/")} />}
      </section>

      <Format />
    </div>
  );
}

function Trust({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-white/40 p-3">
      <span className="mt-0.5 text-brand-500">{icon}</span>
      <div>
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className="text-xs leading-relaxed text-slate-500">{text}</div>
      </div>
    </div>
  );
}

function CurrentData({ saved, source, onDemo, onUpload }: { saved: UploadedMeta | null; source: string; onDemo: () => void; onUpload: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
      <span className="label">Dashboard shows</span>
      <span className={cls("chip", source === "upload" ? "bg-brand-500/15 text-brand-600" : "bg-slate-100 text-slate-700")}>
        {source === "upload" ? "your uploaded data" : "demo data"}
      </span>
      {saved && <span className="text-xs text-slate-500">Last upload: {new Date(saved.loadedAt).toLocaleString("en-IN")}</span>}
      <span className="ml-auto flex gap-2">
        {source === "upload"
          ? <button onClick={onDemo} className="btn-ghost text-xs"><RotateCcw size={13} /> Back to demo data</button>
          : saved && <button onClick={onUpload} className="btn-ghost text-xs">Show my last upload</button>}
      </span>
    </div>
  );
}

function Stepper({ slots, phase }: { slots: Partial<Record<Kind, Slot>>; phase: Phase }) {
  const have = SPECS.filter((s) => s.required && slots[s.kind]?.quick.ok).length;
  const at = phase.kind === "done" ? 4 : phase.kind === "running" || phase.kind === "problems" ? 2 : have === 3 ? 1 : 0;
  const items = ["Add the files", "Quick check", "Full check & analysis", "Open the dashboard"];
  return (
    <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map((t, i) => {
        const bad = phase.kind === "problems" && i === 2;
        const done = i < at && !bad;
        return (
          <li key={t} className={cls("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors",
            bad ? "border-red-500/40 text-red-600" : done ? "border-brand-500/40 text-slate-800" : i === at ? "border-slate-300 text-slate-800" : "border-slate-200 text-slate-400")}>
            <span className={cls("grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[11px]",
              bad ? "bg-red-500 text-white" : done ? "bg-brand-500 text-ink" : "border border-slate-300")}>
              {bad ? "!" : done ? "✓" : i + 1}
            </span>
            {t}
          </li>
        );
      })}
    </ol>
  );
}

function FileSlot({ kind, slot, disabled, onFile, onClear }: { kind: Kind; slot?: Slot; disabled: boolean; onFile: (f: File) => void; onClear: () => void }) {
  const spec = SPECS.find((s) => s.kind === kind)!;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [cols, setCols] = useState(false);
  const state = !slot ? "empty" : slot.quick.ok ? "ok" : "bad";
  return (
    <div className={cls("card flex flex-col p-4 transition-colors",
      state === "ok" && "border-brand-500/40", state === "bad" && "border-red-500/50", over && "border-brand-500")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="mono text-[15px] font-medium text-slate-900">{spec.file}</span>
            <span className={cls("chip", spec.required ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-500")}>{spec.required ? "required" : "optional"}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{spec.what}</p>
        </div>
        <a href={`${SAMPLE}/${spec.file}`} download className="shrink-0 text-slate-400 transition-colors hover:text-brand-500" title={`Download a sample ${spec.file}`}>
          <Download size={15} />
        </a>
      </div>

      <div
        onClick={() => !disabled && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !disabled) onFile(f); }}
        className={cls("mt-3 flex min-h-[86px] cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
          over ? "border-brand-500 bg-brand-500/[0.06]" : state === "ok" ? "border-brand-500/30 bg-brand-500/[0.03]" : state === "bad" ? "border-red-500/40 bg-red-500/[0.04]" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50/50")}>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        {!slot ? (
          <>
            <Upload size={18} className="text-slate-400" />
            <div className="text-sm text-slate-500"><span className="text-slate-800">Drop {spec.file}</span> or click to browse</div>
          </>
        ) : (
          <>
            {state === "ok" ? <CheckCircle2 size={20} className="shrink-0 text-brand-500" /> : <AlertOctagon size={20} className="shrink-0 text-red-500" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{slot.file.name} <span className="font-normal text-slate-400">· {fmtSize(slot.file.size)}</span></div>
              <div className={cls("mt-0.5 text-xs leading-relaxed", state === "ok" ? "text-slate-500" : "text-red-600")}>{slot.quick.message}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onClear(); }} disabled={disabled} aria-label="Remove file" className="shrink-0 text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </>
        )}
      </div>

      <button onClick={() => setCols(!cols)} className="mt-3 flex items-center gap-1 self-start text-xs text-slate-500 hover:text-slate-800">
        <ChevronDown size={13} className={cls("transition-transform", cols && "rotate-180")} />
        {spec.columns.length} columns
      </button>
      {cols ? (
        <table className="mt-2 w-full text-xs">
          <tbody>{spec.columns.map((c) => (
            <tr key={c.name} className="border-t border-slate-100">
              <td className="mono py-1 pr-3 align-top text-slate-800">{c.name}{c.optional && <span className="text-slate-400">?</span>}</td>
              <td className="py-1 text-slate-500">{c.rule}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {spec.columns.map((c) => <span key={c.name} className={cls("mono rounded border px-1.5 py-0.5 text-[11px]", c.optional ? "border-dashed border-slate-200 text-slate-400" : "border-slate-200 text-slate-600")}>{c.name}</span>)}
        </div>
      )}
    </div>
  );
}

function Progress({ phase }: { phase: Extract<Phase, { kind: "running" }> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const idx = STEPS.findIndex((s) => s.id === phase.step);
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-[260px_1fr]">
      <ol className="space-y-2">
        {STEPS.map((s, i) => (
          <li key={s.id} className={cls("flex items-center gap-2.5 text-sm", i < idx ? "text-slate-700" : i === idx ? "text-slate-900" : "text-slate-400")}>
            <span className={cls("grid h-4 w-4 place-items-center rounded-full", i < idx ? "bg-brand-500" : i === idx ? "border-2 border-brand-500" : "border border-slate-300")}>
              {i === idx && <span className="h-1.5 w-1.5 animate-blink rounded-full bg-brand-500" />}
            </span>
            {s.label}
          </li>
        ))}
        <li className="pt-1 font-mono text-[11px] text-slate-400">{((now - phase.started) / 1000).toFixed(0)} s elapsed</li>
      </ol>
      <div className="code min-h-[120px] overflow-hidden">
        {phase.log.map((l, i) => <div key={i} className="truncate">{l}</div>)}
        <div className="relative mt-2 h-px overflow-hidden bg-slate-200"><div className="absolute inset-y-0 w-1/4 animate-scan bg-brand-500" /></div>
      </div>
    </div>
  );
}

function Problems({ problems }: { problems: Problem[] }) {
  const files = Array.from(new Set(problems.map((p) => p.file)));
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-red-500/40">
      <div className="flex items-start gap-3 bg-red-500/[0.08] px-4 py-3">
        <AlertOctagon size={20} className="mt-0.5 shrink-0 text-red-500" />
        <div>
          <div className="font-semibold text-red-600">Wrong file{files.length > 1 ? "s" : ""}: the data was NOT loaded</div>
          <p className="mt-0.5 text-sm text-slate-600">
            Please fix {problems.length === 1 ? "this problem" : `these ${problems.length} problems`} in {files.join(", ")} and upload the correct file{files.length > 1 ? "s" : ""}.
            The dashboard still shows the previous data.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">File</th><th>Row</th><th>Column</th><th className="px-4">Problem</th></tr></thead>
          <tbody>{problems.map((p, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="mono px-4 py-2 text-slate-800">{p.file}</td>
              <td className="mono py-2 text-slate-600">{p.row ?? "–"}</td>
              <td className="mono py-2 text-slate-600">{p.column ?? "–"}</td>
              <td className="px-4 py-2 text-slate-700">{p.message}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Row numbers are spreadsheet line numbers (the header is row 1).</p>
    </div>
  );
}

function Done({ s, onOpen }: { s: Summary; onOpen: () => void }) {
  const ds = s.data_source;
  const off = ds ? Object.entries(ds.features).filter(([, v]) => !v).map(([k]) => FEATURE[k] ?? k) : [];
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-brand-500/40">
      <div className="flex flex-wrap items-center gap-4 bg-brand-500/[0.07] px-4 py-4">
        <CheckCircle2 size={24} className="text-brand-500" />
        <div className="flex-1">
          <div className="text-[17px] font-semibold text-slate-900">Your data passed every check and is analysed</div>
          <div className="text-sm text-slate-500">The whole dashboard now shows your numbers. Switch back to the demo any time.</div>
        </div>
        <button onClick={onOpen} className="btn-primary px-4 py-2">Open dashboard <ArrowRight size={15} /></button>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-5">
        {[["VMs", s.n_vms], ["Resources", s.n_resources], ["Days", s.window_days], ["Readings every", `${ds?.input_step_min.join(" / ")} min`],
          ["Saving found", `₹${s.potential_saving.toLocaleString("en-IN")}/mo`]].map(([k, v]) => (
          <div key={k as string} className="bg-ink px-4 py-3">
            <div className="label">{k}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{v}</div>
          </div>
        ))}
      </div>
      {(ds?.notes.length || off.length) ? (
        <div className="space-y-1.5 px-4 py-3 text-sm">
          {ds?.notes.map((n) => <div key={n} className="flex gap-2 text-amber-700"><span>•</span>{n}</div>)}
          {off.length > 0 && <div className="flex gap-2 text-amber-700"><span>•</span>Turned off for this data length: {off.join(", ")}.</div>}
        </div>
      ) : null}
    </div>
  );
}

const FEATURE: Record<string, string> = {
  forecast: "forecast (needs 14+ days)", backtest: "forecast back-test (needs 21+ days)", trend_alerts: "CPU/memory trend alerts (needs 14+ days)",
  anomaly_alerts: "anomaly alerts (needs 10+ days)", idle_detection: "idle-VM detection (needs 14+ days)",
};

function Format() {
  return (
    <section id="format" className="scroll-mt-20 space-y-4">
      <div>
        <div className="label mb-2 text-brand-500">Acceptance criteria</div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">What a file must meet to be accepted</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          These follow the problem statement (30 days of 5–15 minute metrics, an inventory and a price per resource). If any rule is broken
          the load stops and names the file, row and column. Nothing is guessed or silently fixed. Full reference: DATA_FORMAT.md in the repo.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {CRITERIA.map((g) => (
          <div key={g.group} className="card card-pad">
            <div className="h-section mb-3">{g.group}</div>
            <ol className="space-y-2 text-sm leading-relaxed text-slate-600">
              {g.items.map((t, i) => <li key={i} className="flex gap-2.5"><span className="mono mt-[3px] text-[11px] text-brand-500">{String(i + 1).padStart(2, "0")}</span><span>{t}</span></li>)}
            </ol>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <div className="px-4 pt-4 font-semibold text-slate-900">Accepted, but handled carefully</div>
        <table className="mt-2 w-full min-w-[560px] text-sm">
          <tbody>{DEGRADE.map(([k, v]) => (
            <tr key={k} className="border-t border-slate-100 align-top"><td className="w-56 px-4 py-2 font-medium text-slate-800">{k}</td><td className="px-4 py-2 text-slate-600">{v}</td></tr>
          ))}</tbody>
        </table>
        <p className="px-4 pb-4 pt-2 text-xs text-slate-500">
          Big files (over 400 MB of metrics) are better run on the command line: <span className="mono">python engine/build.py --data &lt;folder&gt;</span>. It uses the same checks.
        </p>
      </div>
      <p className="text-xs text-slate-500">
        Sample files (16 VMs, 30 days, 15-minute readings):{" "}
        {SPECS.map((s, i) => <span key={s.kind}>{i > 0 && " · "}<a href={`${SAMPLE}/${s.file}`} download className="mono underline">{s.file}</a></span>)}
        {" "}or press Try the sample files above.
      </p>
    </section>
  );
}

function fmtSize(b: number) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
