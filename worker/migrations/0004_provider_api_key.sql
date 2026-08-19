-- Phase 4 Migration: Store Provider API Key directly in Database
ALTER TABLE providers ADD COLUMN api_key TEXT;
