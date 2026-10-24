"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Alert, Assumptions, Forecast, Recommendation, Resource, Role, Summary } from "@/lib/types";

interface Data {
  summary: Summary;
  resources: Resource[];
  recs: Recommendation[];
  alerts: Alert[];
  forecast: Forecast;
  assumptions: Assumptions;
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
}

const AppCtx = createContext<Ctx | null>(null);
const KEY = "sco.decisions.v1";

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

  useEffect(() => {
    const get = (n: string) => fetch(`/data/${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`${n}.json: ${r.status}`);
      return r.json();
    });
    Promise.all(["summary", "resources", "recommendations", "alerts", "forecast", "assumptions"].map(get))
      .then(([summary, resources, recs, alerts, forecast, assumptions]) => {
        setData({ summary, resources, recs, alerts, forecast, assumptions });
        const defaults = Object.fromEntries((recs as Recommendation[]).map((r) => [r.id, r.default_accepted]));
        setAccepted({ ...defaults, ...(readStore<Record<string, boolean>>(KEY) ?? {}) });
        const savedRole = readStore<Role>("sco.role");
        if (savedRole) setRoleState(savedRole);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const value = useMemo<Ctx>(() => ({
    data,
    error,
    accepted,
    role,
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
  }), [data, error, accepted, role]);

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
