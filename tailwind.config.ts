import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        brand: { 50: "#eef4ff", 100: "#dbe6ff", 500: "#3366ff", 600: "#2457d6", 700: "#1d46ad" },
        save: { 50: "#ecfdf5", 500: "#10b981", 600: "#059669", 700: "#047857" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
