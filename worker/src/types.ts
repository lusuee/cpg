export type ProviderType = "anthropic" | "openai" | "gemini";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CACHE_KV?: KVNamespace;
  ADMIN_SECRET?: string;
  SESSION_SECRET?: string;
  GATEWAY_BASE_URL?: string;
  APP_NAME?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
  [key: string]: any;
}

export interface ProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string | null;
  api_key: string | null;
  secret_name: string | null;
  enabled: number;
  config_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  model_name: string;
  display_name: string | null;
  alias: string | null;
  fallback_model_id: string | null;
  input_price_per_m: number;
  output_price_per_m: number;
  cache_enabled: number;
  cache_ttl: number;
  enabled: number;
  config_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  enabled: number;
  rate_limit_rpm: number;
  cost_limit_monthly: number | null;
  last_used_at: number | null;
  created_at: number;
  revoked_at: number | null;
  current_month_cost?: number;
}

export interface UsageRow {
  id: number;
  device_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cache_hit: number;
  status_code: number | null;
  latency_ms: number | null;
  request_id: string | null;
  created_at: number;
}

export interface DailyStatsRow {
  date: string;
  device_id: string | null;
  provider_id: string | null;
  model: string | null;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cache_hit_count: number;
  cost_saved_usd: number;
  avg_latency_ms: number;
  error_count: number;
}

export interface ModelWithProvider extends ModelRow {
  provider_name: string;
  provider_type: ProviderType;
  provider_api_key: string | null;
  provider_secret_name: string | null;
  provider_endpoint: string | null;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

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
  month: string; // e.g. "2026-08"
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

