export interface Provider {
  id: string;
  name: string;
  type: "anthropic" | "openai";
  endpoint: string | null;
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
  enabled: number;
  config_json: string | null;
  provider_name?: string;
  provider_type?: string;
}

export interface DeviceItem {
  id: string;
  name: string;
  enabled: number;
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
  status_code: number | null;
  latency_ms: number | null;
  request_id: string | null;
  created_at: number;
}

export interface MetaRow {
  name: string;
  requests: number;
  tokens: number;
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
    avg_latency_ms: number;
    error_count: number;
  };
  byProvider: MetaRow[];
  byModel: MetaRow[];
  trend: { date: string; requests: number; tokens: number }[];
}
