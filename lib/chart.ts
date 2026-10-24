// Shared chart styling for the dark theme.
//
// Recharts takes colours as plain strings (it draws SVG, so Tailwind classes don't reach it),
// which is why the palette lives here instead of in tailwind.config.ts. Keep these in step with
// the CSS variables in app/globals.css if you ever retune the theme.

export const INK = {
  accent: "#c6f432", // lime: savings, "after", the main series
  text: "#e8e8ea", // primary lines that must read on black
  label: "#a1a1a8", // value labels next to bars
  tick: "#8c8c94", // axis tick text
  axis: "#3a3a40",
  grid: "#1f1f23",
  surface: "#141417", // brush background
  bad: "#ff5a4e",
  warn: "#ff9f1c",
} as const;

// Quiet axes and grid so the data stands out.
export const AXIS = { tick: { fontSize: 12, fill: INK.tick }, stroke: INK.axis, tickLine: false, axisLine: false } as const;
export const GRID = { vertical: false, stroke: INK.grid } as const;
export const BRUSH = { height: 28, stroke: INK.accent, fill: INK.surface, travellerWidth: 10 } as const;

// The faint column Recharts paints behind the hovered bar.
export const CURSOR = { fill: "rgb(255 255 255 / 0.04)" } as const;

// Bar labels are a touch bigger in the zoomed popup, where there is room for them.
export const barLabel = (expanded: boolean) => ({ fontSize: expanded ? 13 : 11, fill: INK.label });

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
