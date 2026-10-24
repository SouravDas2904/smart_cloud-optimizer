# Assumptions sheet

Source of truth: `engine/config.py` (also rendered in the app at `/assumptions`). All prices are **illustrative**, as the brief allows.

| Assumption | Value | Why |
|---|---|---|
| Data window | 30 days at 5-minute granularity | Brief: ≥ 30 days at 5–15 min |
| Hours per month | 730 | 8,760 ÷ 12 |
| Rightsizing target | p99 CPU ≤ 70% and p99 memory ≤ 75% (+ ≥ 1 GB free) on the new plan | 30% / 25% headroom |
| Plan choice | Cheapest plan with vCPU ≥ required and RAM ≥ required | |
| Idle | p95 CPU < 5%, p95 net < 0.5 MB/s, p95 IOPS < 10, ≥ 14 days | Three signals must agree |
| Idle in prod | Flagged for owner review, never stopped | Safety |
| Spike check | busiest single 5-min CPU reading ≤ 95% on the new plan (`MAX_CPU_CEILING`) | catches spikes shorter than ~15 min/day that p99 misses |
| Under-provisioned | p99 CPU or memory > 90% → upsize | Reliability first |
| Off-hours schedule | Non-prod with avg off-window CPU < 5%; window 20:00–08:00 weekdays + weekends = 108/168 = 64.3% | |
| Schedule saving | (resized) plan price × 64.3%; storage still billed | No double counting |
| Orphans | Unattached ≥ 7 days. Volume saving = GB × (₹6 − ₹2 snapshot); IP ₹300/mo | Snapshot before delete |
| Risk | HIGH if peak after > 75%, memory-bound, or prod delete; MEDIUM if 60–75%, prod, or bursty (p99/p95 > 2); else LOW | |
| Confidence | 100 − gaps (up to 30) − 20 if < 14 days − 15 if CV > 1 − 10 if rare peaks | |
| Anomaly | Robust z (median/MAD of same hour, weekday/weekend, first 21 days) > 4 for ≥ 30 min | Daily jobs aren't flagged |
| Anomalous VMs | Excluded from sizing until investigated | Don't size on incident data |
| Cost jump | Daily cost > 15% above trailing 7-day average | |
| Capacity | Disk reaches 90% within 21 days (14-day linear fit) | |
| Budget | ₹8.5 L/month; projection = last day's cost × 30.4 | |
| Prices | s-2-4 ₹1,500 … s-16-64 ₹16,000/month; block ₹6/GB-mo; snapshot ₹2/GB-mo; IP ₹300/mo; egress ₹0.80/GB; same in all regions | Illustrative |
| Carbon | 4 W/vCPU × 730 h × PUE 1.4; 0.716 kg CO₂/kWh (India CEA); 21 kg CO₂/tree/yr | Estimate |
| Forecast | Additive Holt-Winters (α 0.4, β 0.05, γ 0.3, weekly season) on daily cost; 7-day back-test MAPE shown | |
| Seed | 42 | Reproducible demo |

## Data generation
Each VM gets a workload pattern: steady-low, healthy, bursty (short daily peak), batch (2-hour nightly job), office-hours dev, idle, memory-heavy, saturated or growing-disk. Series = base + daily shape × weekday factor + noise + events. Planted on purpose: 10 unattached volumes, 6 unused IPs, 8 large ML VMs launched on day 20 (cost jump), one prod VM pegged at ~97% CPU with 25× egress from day 26.4 (anomaly), and metric gaps on 3 VMs. The engine never sees the pattern labels, only the metrics.

## Simplifications
No reserved/committed-use discounts; no autoscaling groups; same prices in every region; bill history before the 30-day window is reconstructed from each resource's launch date (`build.py: bill_history`), assuming today's per-resource monthly cost applied since launch; launch dates themselves are simulated.

## Real-world check

The simulation is benchmarked against the [Azure Public Dataset V2](https://github.com/Azure/AzurePublicDataset/blob/master/AzurePublicDatasetV2.md), using its CPU summary (`azure2019_data_cpu.txt`, 2.7 M VMs, 30 days, 5-minute readings). 58% of real Azure VMs average 10% CPU or less, compared with 50% in our estate, so the savings estimate is conservative. Azure only has CPU (no memory, disk or network), so it is used as a benchmark and does not replace the simulated data. The comparison table is on the Assumptions page.
