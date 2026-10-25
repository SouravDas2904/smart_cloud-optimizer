"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Alert, Assumptions, Fleet, Forecast, Recommendation, Resource, Role, Summary } from "@/lib/types";
import { activeSource, clearCache, loadJson, uploadedMeta, type Source, type UploadedMeta } from "@/lib/dataset";

interface Data {
  summary: Summary;
  resources: Resource[];
  recs: Recommendation[];
  alerts: Alert[];
  forecast: Forecast;
  assumptions: Assumptions;
  fleet: Fleet;
}

interface Ctx {
  data: Data | null;
  error: string | null;
  accepted: Record<string, boolean>;
  setDecision: (id: string, v: boolean) => void;
  setMany: (ids: string[], v: boolean) => void;
  resetDecisions: () => void;
  role: Role;
  setRole: (r: Role) => void;
  /** demo estate or the company's uploaded CSVs (see lib/dataset.ts) */
  source: Source;
  upload: UploadedMeta | null;
  reload: () => void;
}

const AppCtx = createContext<Ctx | null>(null);
const DECISIONS = "sco.decisions.v1";

function readStore<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeStore(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc. – state still works in memory */
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [role, setRoleState] = useState<Role>("engineer");
  const [source, setSource] = useState<Source>("demo");
  const [upload, setUpload] = useState<UploadedMeta | null>(null);
  const [version, setVersion] = useState(0);
  // accept/reject choices are kept per data source, so demo decisions never leak into uploaded data
  const KEY = source === "upload" ? `${DECISIONS}.upload.${upload?.loadedAt ?? ""}` : DECISIONS;

  useEffect(() => {
    const src = activeSource();
    setSource(src);
    setData(null);
    setError(null);
    clearCache();
    const names = ["summary", "resources", "recommendations", "alerts", "forecast", "assumptions", "fleet"] as const;
    Promise.all([src === "upload" ? uploadedMeta() : Promise.resolve(null), ...names.map((n) => loadJson(n))])
      .then(([meta, summary, resources, recs, alerts, forecast, assumptions, fleet]) => {
        setUpload(meta as UploadedMeta | null);
        const key = src === "upload" ? `${DECISIONS}.upload.${(meta as UploadedMeta | null)?.loadedAt ?? ""}` : DECISIONS;
        setData({ summary, resources, recs, alerts, forecast, assumptions, fleet } as Data);
        const defaults = Object.fromEntries((recs as Recommendation[]).map((r) => [r.id, r.default_accepted]));
        setAccepted({ ...defaults, ...(readStore<Record<string, boolean>>(key) ?? {}) });
        const savedRole = readStore<Role>("sco.role");
        if (savedRole) setRoleState(savedRole);
      })
      .catch((e) => setError(String(e)));
  }, [version]);

  const value = useMemo<Ctx>(() => ({
    data,
    error,
    accepted,
    role,
    source,
    upload,
    reload: () => setVersion((v) => v + 1),
    setRole: (r) => { setRoleState(r); writeStore("sco.role", r); },
    setDecision: (id, v) => setAccepted((a) => { const n = { ...a, [id]: v }; writeStore(KEY, n); return n; }),
    setMany: (ids, v) => setAccepted((a) => {
      const n = { ...a };
      ids.forEach((id) => (n[id] = v));
      writeStore(KEY, n);
      return n;
    }),
    resetDecisions: () => {
      if (!data) return;
      const d = Object.fromEntries(data.recs.map((r) => [r.id, r.default_accepted]));
      setAccepted(d);
      writeStore(KEY, d);
    },
  }), [data, error, accepted, role, source, upload, KEY]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside Providers");
  return c;
}

/** Returns loaded data or null; pages render <Loading/> while null. */
export function useData() {
  return useApp().data;
}
