# Bring your own data: the CSV format

SmartCloud Optimizer runs on a company's own exports as well as on the simulated demo estate. There are two ways in,
and both use the same checks (`engine/csv_loader.py`) and the same engine:

- **Website:** the **Upload real data** button (top right) opens `/upload`. Files are checked and analysed inside the
  browser (the Python engine runs in WebAssembly via Pyodide). Nothing is sent to a server.
- **Command line:** `python engine/build.py --data <folder>` writes the dashboard JSON to `public/data/`.

The format follows the UTHO brief: an inventory, at least 30 days of 5 to 15 minute metrics (CPU, memory, disk, IOPS,
network in/out), and a price per resource. A ready-made example is in `public/samples/demo_company/` (16 VMs, 30 days,
15-minute readings); `python engine/make_sample_csv.py <folder>` writes the whole demo estate in this format.

## Files

| File | Required | What |
|---|---|---|
| `inventory.csv` | yes | one row per VM, block volume and public IP |
| `metrics.csv` | yes | one row per VM per reading |
| `pricing.csv` | yes | every plan (size) you can run, including the smaller ones a VM could move to |
| `rates.csv` | no | storage, snapshot, IP and egress prices and the monthly budget; anything left out uses the illustrative default and the dashboard says so |

### inventory.csv

| Column | Rule |
|---|---|
| `id` | unique; 1-64 letters, digits or `. _ : -` |
| `name`, `region`, `team` | any text, not empty |
| `type` | `vm`, `volume` or `ip` |
| `env` | `prod`, `staging` or `dev` |
| `created_at` | ISO date or date-time |
| `plan` | VMs only: a plan in `pricing.csv`; empty for volumes and IPs |
| `vcpu`, `ram_gb` | VMs only: must equal the plan's numbers; empty or 0 otherwise |
| `disk_gb` | VMs and volumes: whole GB (a volume at least 1); empty or 0 for IPs |
| `attached_to` | volumes and IPs: the id of a VM, or empty if unattached; empty for VMs |
| `detached_since` | required for an unattached volume or IP, empty otherwise; not before `created_at` |

### metrics.csv

| Column | Rule |
|---|---|
| `timestamp` | ISO date-time, e.g. `2026-09-24 10:05`. No offset = IST; with an offset (`+05:30`, `Z`) it is converted to IST. One style for the whole file |
| `vm_id` | an id of type `vm` in `inventory.csv` |
| `cpu_pct`, `mem_pct`, `disk_pct` | percent, 0 to 100 |
| `iops` | operations per second, ≥ 0 |
| `net_in_mbps`, `net_out_mbps` | megabytes per second, ≥ 0 |
| `vm_name` | optional; if given it must match the inventory |

### pricing.csv

`plan, vcpu, ram_gb` and exactly one of `price_inr_month` or `price_inr_hour` (× 730 hours = month).

### rates.csv

Rows of `name,value`. Allowed names: `block_inr_per_gb_month`, `snapshot_inr_per_gb_month`, `public_ip_inr_per_month`,
`egress_inr_per_gb`, `monthly_budget_inr`.

## Acceptance criteria (anything else stops the load)

**Files**
1. `inventory.csv`, `metrics.csv` and `pricing.csv` are present; `rates.csv` is optional. On the command line the folder may hold nothing else.
2. Each is a real CSV: UTF-8 text, comma-separated, column names on the first line. Excel (.xlsx/.xls), PDF, JSON, HTML, images, zips, UTF-16 or renamed files are refused.
3. Exactly the documented columns, in any order. Missing, misspelt, repeated or extra columns are refused.
4. Every row has as many values as the header; at least one data row.

**Values and units**
5. `cpu_pct`, `mem_pct`, `disk_pct` are 0-100. A column where every value is between 0 and 1 is refused as fractions.
6. `iops` and network are ≥ 0; network above 12,500 MB/s (100 Gbit/s) is refused as bytes or bits; IOPS above 2,000,000 is refused.
7. No empty cells in `metrics.csv`, no text in number columns, no infinite values.
8. Inventory rules above: valid `type` and `env`, unique ids, plan in the price list with matching vCPU/RAM, consistent attachments.

**Time**
9. Readings every 1 to 60 minutes per VM (median gap). 5-15 minutes is what the brief asks for.
10. At least 7 days and at most 90 days of readings. 30+ days recommended.
11. No duplicate readings (same VM, same time), no readings before the VM's `created_at` date, no inventory dates after the data ends.
12. Every VM in the inventory has readings, and every `vm_id` in the metrics is a VM in the inventory.

Every problem is reported with the file, the row (spreadsheet line, header = 1) and the column, e.g.
`metrics.csv, row 53, column 'cpu_pct': must be at most 100 (found '134')`. The first five rows per problem are listed,
then a count. Nothing is guessed, fixed or skipped silently; the dashboard keeps showing the previous data.

## Accepted, but handled carefully

| Data | What the engine does |
|---|---|
| readings every 1-4 min | moved onto the 5-minute grid keeping the **highest** CPU and memory reading in each slot (disk, IOPS, network: the mean), so a 1-minute spike still reaches the peak and spike checks |
| readings every 6-15 min | each reading is carried forward over the 5-minute slots it covers (15 min → 3 slots) |
| readings every 16-60 min | accepted, but those VMs are **never shrunk**: a spike can hide between readings. The resize becomes a review card that says why |
| under 30 days | resize / schedule / stop: confidence −10 and risk one step higher (LOW→MEDIUM→HIGH), because a monthly job may not appear |
| under 21 days | the forecast is not back-tested (needs 14 days to fit + 7 to test) |
| under 14 days | the forecast and CPU/memory trend alerts are turned off with a message; idle detection (needs 14 days) cannot fire |
| under 10 days | anomaly detection is off (it learns from the first 70% of the window) |
| a VM missing > 20% of its readings, or with under 2 days | not sized: a "Not enough data" card; its cost still counts |
