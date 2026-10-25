export type Env = "prod" | "staging" | "dev";
export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type Action =
  | "resize" | "upsize" | "stop" | "review" | "schedule"
  | "delete_volume" | "release_ip" | "keep" | "investigate";

export interface Stats {
  cpu_avg: number; cpu_p50: number; cpu_p95: number; cpu_p99: number; cpu_max: number;
  mem_avg: number; mem_p95: number; mem_p99: number; mem_max: number;
  cpu_time_above_80: number; offhours_cpu_avg: number; offhours_cpu_p99: number;
  offhours_busy_hours: number[]; offhours_quiet_avg: number; work_cpu_avg: number;
  cpu_trend: Trend; mem_trend: Trend;
  net_p95_mbps: number; iops_p95: number; disk_now: number; disk_slope_per_day: number;
  egress_gb_30d: number; cv: number; days_of_data: number; missing_frac: number;
}

/** least-squares line through the daily p95 of the last 14 days (engine/stats.py: daily_trend) */
export interface Trend { slope: number; level: number; r2: number }

export interface Cost { compute: number; storage: number; network: number; ip: number; total: number }

export interface Resource {
  id: string; name: string; type: "vm" | "volume" | "ip"; region: string; env: Env; team: string;
  created_at: string; plan: string | null; vcpu: number; ram_gb: number; disk_gb: number;
  attached_to: string | null; detached_since: string | null; notes: string;
  cost: Cost; stats: Stats | null; profile: number[][] | null;
}

export interface PeakCheck {
  cpu_p99_before: number; cpu_p99_after: number; mem_p99_before: number; mem_p99_after: number;
  cpu_max_before?: number; cpu_max_after?: number; mem_max_before?: number; mem_max_after?: number; safe: boolean; avg_based_plan?: string;
}

export interface Recommendation {
  id: string; resource_id: string; resource_name: string; resource_type: string;
  env: Env; region: string; team: string; action: Action; title: string; reason: string;
  current_plan: string | null; target_plan: string | null; saving: number; risk: Risk;
  confidence: number; confidence_notes: string[]; maths: string[]; vcpu_removed: number;
  peak_check: PeakCheck | null; keep_hours?: number[]; carbon: { kwh: number; kg_co2: number }; default_accepted: boolean;
  /** 0-1: the risk label picks the third, measured headroom / env / confidence the spot inside it */
  risk_score: number;
  /** schedules only: saving on the current size, used when a plan skips the resize */
  saving_alone?: number;
}

export interface TargetTier { risk: Risk; saving: number; pct: number }

export interface Alert {
  id: string; kind: "anomaly" | "capacity" | "cost_jump" | "budget"; severity: "critical" | "warning" | "info";
  title: string; why: string; resource_id?: string; resource_name?: string; team?: string; env?: Env;
  region?: string; metric?: string; start?: string; end?: string; date?: string; days_left?: number;
  cost_impact: number;
}

export interface DayCost { date: string; inr: number }
export interface Forecast {
  /** mape_7d is null under 21 days of history (no week left to back-test on) */
  history: DayCost[]; mape_7d: number | null; sigma: number | null; budget_monthly: number;
  forecast: { date: string; inr: number; lo: number; hi: number }[];
  /** false when an upload has under 14 days: forecast and usage are then empty and disabled_reason says why */
  enabled?: boolean; disabled_reason?: string | null;
  usage: Record<"cpu" | "mem", UsageForecast> | null;
}
export interface UsageForecast {
  history: { date: string; pct: number }[]; mape_7d: number | null;
  forecast: { date: string; pct: number; lo: number; hi: number }[];
}

/** where the numbers come from (engine/build.py: data_source) */
export interface DataSource {
  kind: "simulated" | "csv"; name: string; notes: string[]; input_step_min: number[];
  features: { forecast: boolean; backtest: boolean; trend_alerts: boolean; anomaly_alerts: boolean; idle_detection: boolean };
}

export interface Summary {
  generated_at: string; window_start?: string; data_source?: DataSource; window_days: number; step_min: number; n_resources: number; n_vms: number;
  n_points: number; current_monthly: number; projected_next_month: number; budget_monthly: number;
  potential_saving: number; by_env: Record<string, number>; by_region: Record<string, number>;
  by_team: Record<string, number>; by_type: Record<string, number>; by_component: Record<string, number>;
  bill_history: { month: string; inr: number }[]; counts: Record<string, number>;
  target_tiers: TargetTier[];
}

export interface Series {
  start: string; step_min: number; cpu: (number | null)[]; cpu_max: (number | null)[];
  mem: (number | null)[]; disk: (number | null)[]; iops: (number | null)[];
  net_in: (number | null)[]; net_out: (number | null)[]; hourly_cpu: number[]; heatmap_cpu: number[][];
}

export type Assumptions = Record<string, unknown> & {
  PLANS: Record<string, [number, number, number]>;
  TARGET_CPU_UTIL: number; TARGET_MEM_UTIL: number; MIN_MEM_MARGIN_GB: number; MAX_CPU_CEILING: number; MAX_MEM_CEILING: number;
  WATTS_PER_VCPU: number; PUE: number; GRID_KG_CO2_PER_KWH: number; HOURS_PER_MONTH: number;
  KG_CO2_PER_TREE_YEAR: number; OFF_HOURS_FRACTION: number; MONTHLY_BUDGET_INR: number;
};

export interface FleetGroup {
  vms: number; vcpu: number; ram_gb: number; disk_gb: number; egress_gb: number; cpu_pct: number; mem_pct: number; disk_pct: number;
}
export interface Fleet {
  timeline: {
    start: string; step_min: number; cpu_pct: number[]; mem_pct: number[]; disk_pct: number[];
    vcpu_used: number[]; vcpu_prov: number[]; net_in_mbps: number[]; net_out_mbps: number[]; iops: number[];
  };
  by_region: Record<string, FleetGroup>; by_team: Record<string, FleetGroup>; by_env: Record<string, FleetGroup>;
}

/** hourly fleet sums per (region, env, team): add any selection of cells to filter the utilization charts */
export interface FleetCell {
  region: string; env: Env; team: string; vms: number;
  vcpu_used: number[]; vcpu_prov: number[]; ram_used: number[]; ram_prov: number[];
  disk_used: number[]; disk_prov: number[]; net_in: number[]; net_out: number[];
}
export interface FleetCells { start: string; step_min: number; cells: FleetCell[] }

export type Role = "engineer" | "finance" | "leadership";
