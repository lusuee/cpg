import type { Env } from "../types";

export const INIT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    endpoint TEXT,
    secret_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    display_name TEXT,
    alias TEXT,
    fallback_model_id TEXT,
    input_price_per_m REAL NOT NULL DEFAULT 0,
    output_price_per_m REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    rate_limit_rpm INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    created_at INTEGER,
    revoked_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    provider_id TEXT,
    provider_name TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    status_code INTEGER,
    latency_ms INTEGER,
    request_id TEXT,
    created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_provider_id ON usage (provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_model ON usage (model)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_device_id ON usage (device_id)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats (date)`
];

const MIGRATION_ALTERS = [
  "ALTER TABLE models ADD COLUMN fallback_model_id TEXT",
  "ALTER TABLE models ADD COLUMN input_price_per_m REAL NOT NULL DEFAULT 0",
  "ALTER TABLE models ADD COLUMN output_price_per_m REAL NOT NULL DEFAULT 0",
  "ALTER TABLE devices ADD COLUMN rate_limit_rpm INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE usage ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0",
];

let schemaInitialized = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (schemaInitialized) return;
  if (!env?.DB) return;
  try {
    const stmts = INIT_STATEMENTS.map((sql) => env.DB.prepare(sql));
    await env.DB.batch(stmts);

    for (const sql of MIGRATION_ALTERS) {
      try {
        await env.DB.prepare(sql).run();
      } catch {
        // ignore error if column already exists
      }
    }

    schemaInitialized = true;
  } catch (err) {
    console.error("Auto schema initialization failed:", err);
  }
}

