export type ProviderType = "anthropic" | "openai";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_SECRET?: string;
  SESSION_SECRET?: string;
  GATEWAY_BASE_URL?: string;
  APP_NAME?: string;
  [key: string]: any;
}

export interface ProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string | null;
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
  last_used_at: number | null;
  created_at: number;
  revoked_at: number | null;
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
  status_code: number | null;
  latency_ms: number | null;
  request_id: string | null;
  created_at: number;
}

export interface ModelWithProvider extends ModelRow {
  provider_name: string;
  provider_type: ProviderType;
  provider_secret_name: string | null;
  provider_endpoint: string | null;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}
