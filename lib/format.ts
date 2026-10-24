export const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

/** ₹9.3L style for headline numbers */
export const inrShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};

export const pct = (n: number, d = 0) => `${n.toFixed(d)}%`;

export const ACTION_LABEL: Record<string, string> = {
  resize: "Resize",
  upsize: "Upsize",
  stop: "Stop idle",
  review: "Owner review",
  schedule: "Off-hours schedule",
  delete_volume: "Orphaned volume",
  release_ip: "Unused IP",
  keep: "Peak protected",
  investigate: "Investigate",
};

export const ENV_COLOR: Record<string, string> = { prod: "#2457d6", staging: "#8b5cf6", dev: "#14b8a6" };
export const CHART = ["#2457d6", "#14b8a6", "#8b5cf6", "#f59e0b", "#ef4444", "#64748b", "#0ea5e9"];

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
