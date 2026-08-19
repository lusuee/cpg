-- Phase 3 Schema Enhancements: KV Cache & Export Metrics
-- 1. Alter models table with cache_enabled and cache_ttl
ALTER TABLE models ADD COLUMN cache_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN cache_ttl INTEGER NOT NULL DEFAULT 3600;

-- 2. Alter usage table with cache_hit
ALTER TABLE usage ADD COLUMN cache_hit INTEGER NOT NULL DEFAULT 0;

-- 3. Alter daily_stats table with cache_hit_count and cost_saved_usd
ALTER TABLE daily_stats ADD COLUMN cache_hit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN cost_saved_usd REAL NOT NULL DEFAULT 0;
