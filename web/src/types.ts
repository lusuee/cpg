export interface Provider {
  id: string;
  name: string;
  type: "anthropic" | "openai" | "gemini";
  endpoint: string | null;
  api_key?: string | null;
  api_key_masked?: string | null;
  api_key_configured?: boolean;
  secret_name: string | null;
  enabled: number;
  config_json: string | null;
  secret_configured?: boolean;
  health_status?: "healthy" | "degraded" | "unhealthy" | "unknown";
  health_latency_ms?: number;
  last_ping_at?: number;
  health_message?: string;
}

export interface ModelItem {
  id: string;
  provider_id: string;
  model_name: string;
  display_name: string | null;
  alias: string | null;
  fallback_model_id: string | null;
  input_price_per_m: number;
  output_price_per_m: number;
  cache_enabled?: number;
  cache_ttl?: number;
  enabled: number;
  config_json: string | null;
  provider_name?: string;
  provider_type?: string;
  capabilities?: string[];
  routing_strategy?: "priority" | "lowest_latency" | "weighted";
  weight?: number;
}

export interface DeviceItem {
  id: string;
  name: string;
  enabled: number;
  rate_limit_rpm: number;
  cost_limit_monthly?: number | null;
  current_month_cost?: number;
  last_used_at: number | null;
  created_at: number;
  revoked_at: number | null;
}

export interface UsageItem {
  id: number;
  device_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cache_hit?: number;
  status_code: number | null;
  latency_ms: number | null;
  request_id: string | null;
  created_at: number;
}

export interface MetaRow {
  name: string;
  requests: number;
  tokens: number;
  cost_usd?: number;
  avg_latency_ms: number;
  errors: number;
}

export interface StatsResponse {
  range: string;
  since: number;
  summary: {
    request_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd?: number;
    cache_hit_count?: number;
    avg_latency_ms: number;
    error_count: number;
  };
  byProvider: MetaRow[];
  byModel: MetaRow[];
  trend: { date: string; requests: number; tokens: number; cost_usd?: number }[];
}

export interface CacheAnalyticsResponse {
  total_requests: number;
  cache_hits: number;
  cache_hit_rate: number;
  tokens_saved: number;
  cost_saved_usd: number;
  avg_cached_latency_ms: number;
  avg_direct_latency_ms: number;
  acceleration_ratio: number;
}

export interface ModelLatencyBenchmarkItem {
  model: string;
  provider_name: string;
  requests: number;
  avg_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  p90_latency_ms: number;
  error_count: number;
  error_rate: number;
}

export type ModelLatencyItem = ModelLatencyBenchmarkItem;

export interface MonthlyReportBreakdownItem {
  key: string;
  name: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  share_percent: number;
}

export interface MonthlyReportDailyTrend {
  date: string;
  request_count: number;
  total_tokens: number;
  cost_usd: number;
}

export interface MonthlyReport {
  month: string;
  start_time: number;
  end_time: number;
  total_cost_usd: number;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  cache_hit_count: number;
  cache_saved_tokens: number;
  cache_saved_cost_usd: number;
  by_provider: MonthlyReportBreakdownItem[];
  by_model: MonthlyReportBreakdownItem[];
  by_device: MonthlyReportBreakdownItem[];
  daily_trend: MonthlyReportDailyTrend[];
  mom_growth: {
    previous_month: string;
    previous_cost_usd: number;
    previous_requests: number;
    cost_growth_percent: number;
    request_growth_percent: number;
  };
}

export interface CostAnomalyAlert {
  is_anomaly: boolean;
  spike_date?: string;
  spike_cost_usd?: number;
  baseline_avg_usd?: number;
  spike_ratio?: number;
  message?: string;
  top_contributor_model?: string;
  top_contributor_device?: string;
}

export interface ModelSpendRankItem {
  model: string;
  display_name?: string;
  request_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  share_percent: number;
  avg_cost_per_request: number;
}

export interface CostAnalytics {
  range: string;
  total_cost_usd: number;
  anomaly_alert: CostAnomalyAlert;
  model_ranking: ModelSpendRankItem[];
}

export interface BudgetConfigResponse {
  monthly_budget_usd: number;
  budget_action: "warn" | "block";
  alert_threshold_pct: number;
  spent_this_month_usd: number;
}

export interface WebhookConfigResponse {
  url: string;
  events: string[];
  secret_configured: boolean;
}


