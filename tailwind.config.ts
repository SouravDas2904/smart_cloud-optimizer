import type { Config } from "tailwindcss";

// Every colour is a CSS variable (see globals.css) so the dark screen theme and the
// light print theme share one set of class names.
const scale = (name: string, steps: (number | string)[]) =>
  Object.fromEntries(steps.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--white) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        slate: scale("slate", STEPS),
        brand: scale("brand", [50, 100, 500, 600, 700]),
        save: scale("save", [50, 500, 600, 700]),
        emerald: scale("save", [50, 200, 500, 600, 700, 800, 900]),
        red: scale("red", [50, 100, 200, 500, 600, 700, 800]),
        amber: scale("amber", [50, 200, 400, 500, 600, 700, 800]),
        blue: scale("blue", [50, 700]),
        violet: scale("violet", [50, 700]),
        teal: scale("teal", [50, 700]),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        blink: { "50%": { opacity: "0.25" } },
        scan: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(400%)" } },
      },
      animation: {
        rise: "rise .45s cubic-bezier(.2,.7,.2,1) both",
        blink: "blink 1.4s steps(2, start) infinite",
        scan: "scan 2.8s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
