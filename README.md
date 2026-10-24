# SmartCloud Optimizer

**TransfiNITTe 2026 · UTHO problem statement.** SmartCloud Optimizer turns cloud utilization data into decisions an infrastructure engineer can trust: what to resize, stop, delete or schedule, how much each change saves, and how risky it is. Every rupee comes with the formula behind it.

## What it does

| Must-have (from the brief) | Where |
|---|---|
| Fleet utilization dashboard: CPU, memory, storage and network over 30 days, by region/team/env, top consumers | `/utilization` |
| Per-resource utilization (CPU, memory, disk, network, IOPS), filter by region/env/team, drill into history | `/resources`, `/resources/[id]` |
| Rightsizing engine based on **p99 peak + 30% headroom**, never averages | `engine/recommend.py` |
| Actionable recommendations: action, reason, ₹ saving, risk, confidence | `/recommendations` |
| Before vs after cost, accept/reject with live totals | `/savings`, sticky footer |
| Alerts that explain why: anomaly, cost jump, capacity, budget overrun | `/alerts`, `engine/alerts.py` |

Bonus: 30/60/90-day forecast (Holt-Winters), what-if simulator (shutdown windows + headroom policy), AI plain-language explanations (Claude, with rule-based fallback), CSV / Terraform / shell / PDF export, sustainability (kWh, CO₂), Engineer / Finance / Leadership views.

**The safety showcase:** `prod-reports-01` averages ~10% CPU but hits ~80% every day at 10:00. An average-based tool would shrink it to 2 vCPU (peak → 322%). Our engine refuses and explains why. Similarly, `prod-pay-api-07` has an active anomaly, so sizing is paused instead of "learning" the incident.

## Architecture

```
engine/generate.py  → simulated estate: 96 VMs, 10 volumes, 36 IPs, 30 days × 5-min metrics (seeded)
engine/build.py     → stats (p50/p95/p99, profiles) → recommendations → alerts → forecast → fleet roll-up → public/data/*.json
engine/export_csv.py → every number above as CSV files (raw 5-min metrics included)
app/ (Next.js)      → dashboard reads the JSON; accept/reject, what-if and headroom recomputed live in lib/engine.ts
app/api/explain     → optional Claude explanation, grounded only on the card's numbers
```

All thresholds and prices live in `engine/config.py` and are shown in-app on `/assumptions` (also `ASSUMPTIONS.md`).

### Where the look comes from

- `app/globals.css`: the dark theme. Every Tailwind colour reads a CSS variable, so `bg-white` is the card surface and
  `text-slate-900` is near-white text. A `@media print` block swaps the same variables back to light for printed reports.
- `lib/chart.ts`: chart colours, axis and grid styles shared by every Recharts chart (SVG can't use Tailwind classes).
- `components/ChartCard.tsx`: any chart card can be clicked to open a large popup with a zoom slider.
- `components/FleetGrid.tsx`, `CommandPalette.tsx` (Ctrl K), `motion.tsx` (count-up numbers, fade-in), `Spotlight.tsx` (card glow under the cursor).

## Run it

```bash
npm install
npm run dev            # http://localhost:3000 (uses the committed data in public/data)
```

Regenerate the data and run the engine tests (Python 3.11+):

```bash
pip install -r engine/requirements.txt
npm run data           # generate.py + build.py
npm run test:engine    # pytest
```

Optional AI explanations: set `ANTHROPIC_API_KEY` in Vercel → Project → Settings → Environment Variables. Without it the app uses rule-based explanations.

## Deploy

Import the repo in Vercel (framework: Next.js, root: repo root). No other services are needed.
