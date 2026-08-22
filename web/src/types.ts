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
}

export interface DeviceItem {
  id: string;
  name: string;
  enabled: number;
  rate_limit_rpm: number;
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

export interface ModelLatencyItem {
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


