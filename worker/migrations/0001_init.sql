-- Cloudflare Personal AI Gateway - initial schema
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  endpoint TEXT,
  secret_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT,
  alias TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  provider_id TEXT,
  provider_name TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  latency_ms INTEGER,
  request_id TEXT,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider_id ON usage (provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage (model);
CREATE INDEX IF NOT EXISTS idx_usage_device_id ON usage (device_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT,
  updated_at INTEGER
);
