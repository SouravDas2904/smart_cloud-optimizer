// Shared chart styling: quiet axes and grid so the data stands out.
export const AXIS = { tick: { fontSize: 11, fill: "#64748b" }, stroke: "#cbd5e1", tickLine: false, axisLine: false } as const;
export const GRID = { vertical: false, stroke: "#f1f5f9" } as const;
export const BRUSH = { height: 28, stroke: "#2457d6", fill: "#f8fafc", travellerWidth: 10 } as const;
export const fmtDay = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
/** ₹9.3L without the space, so axis ticks and bar labels never wrap onto two lines */
export const inrTick = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`;
  return `₹${Math.round(v)}`;
};
