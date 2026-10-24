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

export const ENV_COLOR: Record<string, string> = { prod: "#e8e8ea", staging: "#8b9cff", dev: "#4fd1c5" };
export const CHART = ["#c6f432", "#4fd1c5", "#b48cff", "#ff9f1c", "#ff5a4e", "#6b6b73", "#5cc8ff"];

export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
