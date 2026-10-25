// The upload format, for the Upload real data page. The full check is engine/csv_loader.py (it runs in the
// browser too); quickCheck below only gives instant feedback on a dropped file before the engine starts.
// Keep the column lists in step with csv_loader.FILES.

export type Kind = "inventory" | "metrics" | "pricing" | "rates";

export interface FileSpec {
  kind: Kind; file: string; required: boolean; title: string; what: string;
  columns: { name: string; rule: string; optional?: boolean }[];
  maxMb: number;
}

export const SPECS: FileSpec[] = [
  {
    kind: "inventory", file: "inventory.csv", required: true, title: "Inventory", maxMb: 20,
    what: "One row per VM, block volume and public IP.",
    columns: [
      { name: "id", rule: "unique, 1–64 letters/digits . _ : -" },
      { name: "name", rule: "any text" },
      { name: "type", rule: "vm, volume or ip" },
      { name: "region", rule: "any text, e.g. Mumbai" },
      { name: "env", rule: "prod, staging or dev" },
      { name: "team", rule: "any text" },
      { name: "created_at", rule: "date or date-time, e.g. 2026-03-01" },
      { name: "plan", rule: "VMs only: a plan from pricing.csv" },
      { name: "vcpu", rule: "VMs only: must match the plan" },
      { name: "ram_gb", rule: "VMs only: must match the plan" },
      { name: "disk_gb", rule: "VMs and volumes: whole GB" },
      { name: "attached_to", rule: "volumes/IPs: a VM id, or empty if unattached" },
      { name: "detached_since", rule: "unattached volumes/IPs only: date" },
    ],
  },
  {
    kind: "metrics", file: "metrics.csv", required: true, title: "Metrics", maxMb: 400,
    what: "One row per VM per reading, every 1–60 minutes (5–15 recommended), at least 7 days (30 recommended).",
    columns: [
      { name: "timestamp", rule: "2026-09-24 10:05 (IST) or with an offset like +05:30" },
      { name: "vm_id", rule: "an id of type vm in inventory.csv" },
      { name: "cpu_pct", rule: "0–100 (percent, not 0–1)" },
      { name: "mem_pct", rule: "0–100" },
      { name: "disk_pct", rule: "0–100, disk space used" },
      { name: "iops", rule: "≥ 0, operations per second" },
      { name: "net_in_mbps", rule: "≥ 0, megabytes per second" },
      { name: "net_out_mbps", rule: "≥ 0, megabytes per second" },
      { name: "vm_name", rule: "optional: must match inventory", optional: true },
    ],
  },
  {
    kind: "pricing", file: "pricing.csv", required: true, title: "Price list", maxMb: 5,
    what: "Every plan (size) you can run, including the smaller ones a VM could move to.",
    columns: [
      { name: "plan", rule: "unique plan name" },
      { name: "vcpu", rule: "whole number ≥ 1" },
      { name: "ram_gb", rule: "≥ 0.5" },
      { name: "price_inr_month", rule: "₹ per month, or use price_inr_hour instead", optional: true },
      { name: "price_inr_hour", rule: "₹ per hour (× 730 = month)", optional: true },
    ],
  },
  {
    kind: "rates", file: "rates.csv", required: false, title: "Rates & budget", maxMb: 1,
    what: "Optional. Rows of name,value. Anything left out uses the illustrative default (and says so).",
    columns: [
      { name: "name", rule: "block_inr_per_gb_month, snapshot_inr_per_gb_month, public_ip_inr_per_month, egress_inr_per_gb, monthly_budget_inr" },
      { name: "value", rule: "number ≥ 0" },
    ],
  },
];

export const SPEC_BY_KIND = Object.fromEntries(SPECS.map((s) => [s.kind, s])) as Record<Kind, FileSpec>;

/** Which slot a dropped file belongs to, from its name (inventory.csv, my_metrics.csv, ...). */
export function kindFromName(name: string): Kind | null {
  const n = name.toLowerCase();
  return SPECS.find((s) => n.includes(s.kind))?.kind ?? null;
}

const MAGIC: [number[], string][] = [
  [[0x50, 0x4b, 0x03, 0x04], "an Excel workbook or zip archive. In Excel use File → Save As → CSV UTF-8"],
  [[0x25, 0x50, 0x44, 0x46], "a PDF document"],
  [[0xd0, 0xcf, 0x11, 0xe0], "an old Excel .xls file. Save it as CSV UTF-8"],
  [[0x89, 0x50, 0x4e, 0x47], "a PNG image"],
  [[0xff, 0xd8, 0xff], "a JPEG image"],
];

export interface Quick { ok: boolean; message: string }

/** Instant checks on one file: type, size, encoding, separator and header. The engine re-checks everything. */
export async function quickCheck(kind: Kind, file: File): Promise<Quick> {
  const spec = SPEC_BY_KIND[kind];
  if (!file.name.toLowerCase().endsWith(".csv")) {
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "no extension";
    return { ok: false, message: `Wrong file: this is a .${ext} file. Please upload a .csv file (${spec.file}).` };
  }
  if (file.size === 0) return { ok: false, message: "Wrong file: it is empty." };
  if (file.size > spec.maxMb * 1024 * 1024) {
    return { ok: false, message: `Too large for the browser (${(file.size / 1048576).toFixed(0)} MB, limit ${spec.maxMb} MB). Use the command line: python engine/build.py --data <folder>.` };
  }
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  for (const [magic, what] of MAGIC) {
    if (magic.every((b, i) => head[i] === b)) return { ok: false, message: `Wrong file: this is not a CSV, it is ${what}.` };
  }
  if (head.includes(0)) return { ok: false, message: "Wrong file: it contains binary data, so it is not a CSV (or it is saved as UTF-16; save as CSV UTF-8)." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(head.length === 65536 ? head.slice(0, head.lastIndexOf(10) + 1 || head.length) : head);
  } catch {
    return { ok: false, message: "Wrong file: it is not UTF-8 text. Save it as CSV UTF-8." };
  }
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return { ok: false, message: "Wrong file: this is JSON, not CSV." };
  if (t.startsWith("<")) return { ok: false, message: "Wrong file: this is HTML or XML, not CSV." };
  const first = t.split(/\r?\n/, 1)[0];
  if (!first.includes(",")) {
    const sep = first.includes(";") ? "semicolons" : first.includes("\t") ? "tabs" : null;
    return { ok: false, message: sep ? `Wrong file: columns are separated by ${sep}; they must be separated by commas.` : `Wrong file: the first line must be the column names separated by commas.` };
  }
  const header = first.split(",").map((h) => h.trim());
  const required = spec.columns.filter((c) => !c.optional).map((c) => c.name);
  const allowed = spec.columns.map((c) => c.name);
  const missing = required.filter((c) => !header.includes(c));
  const unknown = header.filter((h) => !allowed.includes(h));
  const dupes = header.filter((h, i) => header.indexOf(h) !== i);
  if (missing.length === required.length) {
    return { ok: false, message: `Wrong file: this does not look like the ${spec.title.toLowerCase()} file. None of its columns (${required.slice(0, 4).join(", ")}, …) are there.` };
  }
  const bits = [];
  if (missing.length) bits.push(`missing column(s): ${missing.join(", ")}`);
  if (unknown.length) bits.push(`unexpected column(s): ${unknown.join(", ")}`);
  if (dupes.length) bits.push(`repeated column(s): ${dupes.join(", ")}`);
  if (kind === "pricing" && header.includes("price_inr_month") === header.includes("price_inr_hour")) bits.push("give exactly one of price_inr_month or price_inr_hour");
  if (bits.length) return { ok: false, message: `Wrong file: ${bits.join("; ")}.` };
  if (t.split(/\r?\n/).filter((l) => l.trim()).length < 2) return { ok: false, message: "Wrong file: it has column names but no data rows." };
  return { ok: true, message: `Header looks right (${header.length} columns). Every row is checked when you press Check & analyse.` };
}

export interface Problem { file: string; row: number | null; column: string | null; message: string }

/** The acceptance criteria, shown on the page and kept in step with DATA_FORMAT.md and csv_loader.py. */
export const CRITERIA: { group: string; items: string[] }[] = [
  { group: "Files", items: [
    "Three files are required: inventory.csv, metrics.csv and pricing.csv. rates.csv is optional.",
    "Each must be a real CSV: plain UTF-8 text, comma-separated, column names on the first line. Excel (.xlsx/.xls), PDF, JSON, images, zips or renamed files are refused.",
    "Exactly the documented columns, any order. A missing, misspelt, repeated or extra column stops the load.",
    "Every row must have the same number of values as the header.",
  ] },
  { group: "Values and units", items: [
    "cpu_pct, mem_pct and disk_pct are percentages 0 to 100. Fractions (all values 0 to 1) are refused.",
    "iops and network are numbers ≥ 0; network is in megabytes per second (values above 12,500 MB/s are refused as bytes or bits).",
    "No empty cells in metrics.csv, no text in number columns, no infinite values.",
    "env is prod, staging or dev; type is vm, volume or ip; ids are unique.",
    "Every VM's plan is in pricing.csv and its vcpu / ram_gb match that plan.",
    "Volumes and IPs: attached_to is a VM id, or empty with a detached_since date.",
  ] },
  { group: "Time", items: [
    "Timestamps are ISO dates/times (2026-09-24 10:05). Without an offset they are IST; one style for the whole file.",
    "Readings every 1 to 60 minutes per VM. 5 to 15 minutes is what the brief asks for.",
    "At least 7 days, at most 90 days. 30 days or more is recommended (the brief asks for 30).",
    "No duplicate readings (same VM, same time), no readings before a VM's created_at, no dates after the data ends.",
    "Every VM in inventory.csv has readings in metrics.csv, and every vm_id in metrics.csv is a VM in inventory.csv.",
  ] },
];

/** What the engine does with data that is accepted but not ideal. */
export const DEGRADE: [string, string][] = [
  ["Readings every 1–4 min", "Combined into 5-minute steps keeping the highest CPU and memory reading, so short spikes still reach the peak check."],
  ["Readings every 16–60 min", "Accepted, but the engine never shrinks those VMs: a spike can hide between readings. You get a review card instead."],
  ["7–13 days", "Forecast and CPU/memory trend alerts are turned off with a message. Idle detection (needs 14 days) is off."],
  ["Under 21 days", "The forecast is not back-tested (needs 14 days to fit plus 7 to test)."],
  ["Under 30 days", "Resize / schedule / stop: confidence −10 and risk one step higher, because a monthly job may not appear."],
  ["A VM missing > 20% of readings", "Not sized: a “Not enough data” card explains why. Its cost still counts."],
];
