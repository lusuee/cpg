-- Phase 2 Schema Enhancements
-- 1. Daily Aggregated Stats Table
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT NOT NULL,
  device_id TEXT,
  provider_id TEXT,
  model TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, device_id, provider_id, model)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats (date);

-- 2. Alter models table with fallback and pricing
ALTER TABLE models ADD COLUMN fallback_model_id TEXT;
ALTER TABLE models ADD COLUMN input_price_per_m REAL NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN output_price_per_m REAL NOT NULL DEFAULT 0;

-- 3. Alter devices table with rate limit RPM
ALTER TABLE devices ADD COLUMN rate_limit_rpm INTEGER NOT NULL DEFAULT 0;

-- 4. Alter usage table with cost estimation
ALTER TABLE usage ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
