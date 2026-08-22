-- Migration 0005: Performance Indexes on Hot Path & Model Lookups
CREATE INDEX IF NOT EXISTS idx_models_model_lookup ON models (model_name, enabled);
CREATE INDEX IF NOT EXISTS idx_models_alias_lookup ON models (alias, enabled);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models (provider_id);
