// Where the dashboard's numbers come from: the demo estate in /public/data, or a company's own CSVs that the
// Upload real data page ran through the engine in this browser. Uploaded results are kept in IndexedDB on this
// computer only (never sent anywhere), so every page and a reload keep showing them until "Back to demo data".

const DB = "smartcloud";
const STORE = "uploaded";
const ACTIVE_KEY = "sco.source";          // "upload" while an uploaded dataset is being viewed

export type Source = "demo" | "upload";

export interface UploadedOutputs {
  summary: unknown; resources: unknown; recommendations: unknown; alerts: unknown; forecast: unknown;
  assumptions: unknown; fleet: unknown; fleet_cells: unknown; series: Record<string, unknown>;
}

export interface UploadedMeta { name: string; loadedAt: string; files: Record<string, { name: string; size: number }> }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export function activeSource(): Source {
  try {
    return localStorage.getItem(ACTIVE_KEY) === "upload" ? "upload" : "demo";
  } catch {
    return "demo";
  }
}

export async function saveUpload(outputs: UploadedOutputs, meta: UploadedMeta) {
  await tx("readwrite", (s) => { s.put(outputs, "outputs"); s.put(meta, "meta"); });
  try { localStorage.setItem(ACTIVE_KEY, "upload"); } catch { /* still works for this visit */ }
}

export async function showDemo() {
  try { localStorage.setItem(ACTIVE_KEY, "demo"); } catch { /* ignore */ }
}

export async function switchToUpload(): Promise<boolean> {
  if (!(await uploadedMeta())) return false;
  try { localStorage.setItem(ACTIVE_KEY, "upload"); } catch { /* ignore */ }
  return true;
}

export async function forgetUpload() {
  await tx("readwrite", (s) => { s.delete("outputs"); s.delete("meta"); });
  await showDemo();
}

export async function uploadedMeta(): Promise<UploadedMeta | null> {
  try {
    return ((await tx("readonly", (s) => s.get("meta"))) as UploadedMeta | undefined) ?? null;
  } catch {
    return null;
  }
}

let cache: UploadedOutputs | null = null;
async function uploaded(): Promise<UploadedOutputs> {
  if (!cache) {
    cache = ((await tx("readonly", (s) => s.get("outputs"))) as UploadedOutputs | undefined) ?? null;
    if (!cache) throw new Error("The uploaded data is no longer stored in this browser. Upload it again or go back to the demo data.");
  }
  return cache;
}
export function clearCache() { cache = null; }

/** One of the dashboard JSON files (summary, resources, recommendations, ...), from whichever source is active. */
export async function loadJson<T = unknown>(name: keyof Omit<UploadedOutputs, "series">): Promise<T> {
  if (activeSource() === "upload") return (await uploaded())[name] as T;
  const r = await fetch(`/data/${name}.json`);
  if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
  return r.json();
}

/** A VM's 30-minute chart series. */
export async function loadSeries<T = unknown>(id: string): Promise<T> {
  if (activeSource() === "upload") {
    const s = (await uploaded()).series[id];
    if (!s) throw new Error(`no series for ${id}`);
    return s as T;
  }
  const r = await fetch(`/data/series/${id}.json`);
  if (!r.ok) throw new Error(`series ${id}: ${r.status}`);
  return r.json();
}
