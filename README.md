# SmartCloud Optimizer

**TransfiNITTe 2026 · UTHO problem statement.** SmartCloud Optimizer turns cloud utilization data into decisions an infrastructure engineer can trust: what to resize, stop, delete or schedule, how much each change saves, and how risky it is. Every rupee comes with the formula behind it.

## What it does

| Must-have (from the brief) | Where |
|---|---|
| Resource utilization dashboard, filter by region/env/team, drill into history | `/resources`, `/resources/[id]` |
| Rightsizing engine based on **p99 peak + 30% headroom**, never averages | `engine/recommend.py` |
| Actionable recommendations: action, reason, ₹ saving, risk, confidence | `/recommendations` |
| Before vs after cost, accept/reject with live totals | `/savings`, sticky footer |
| Alerts that explain why: anomaly, cost jump, capacity, budget overrun | `/alerts`, `engine/alerts.py` |

Bonus: 30/60/90-day forecast (Holt-Winters), what-if simulator (shutdown windows + headroom policy), AI plain-language explanations (Claude, with rule-based fallback), CSV / Terraform / shell / PDF export, sustainability (kWh, CO₂), Engineer / Finance / Leadership views.

**The safety showcase:** `prod-reports-01` averages ~10% CPU but hits ~80% every day at 10:00. An average-based tool would shrink it to 2 vCPU (peak → 322%). Our engine refuses and explains why. Similarly, `prod-pay-api-07` has an active anomaly, so sizing is paused instead of "learning" the incident.

## Architecture

```
engine/generate.py  → simulated estate: 96 VMs, 10 volumes, 36 IPs, 30 days × 5-min metrics (seeded)
engine/build.py     → stats (p50/p95/p99, profiles) → recommendations → alerts → forecast → public/data/*.json
app/ (Next.js)      → dashboard reads the JSON; accept/reject, what-if and headroom recomputed live in lib/engine.ts
app/api/explain     → optional Claude explanation, grounded only on the card's numbers
```

All thresholds and prices live in `engine/config.py` and are shown in-app on `/assumptions` (also `ASSUMPTIONS.md`).

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
