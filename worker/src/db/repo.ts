import type {
  DailyStatsRow,
  DeviceRow,
  Env,
  ModelWithProvider,
  ProviderRow,
  ProviderType,
  TokenUsage,
  UsageRow,
  MonthlyReport,
  MonthlyReportBreakdownItem,
  MonthlyReportDailyTrend,
  CostAnalytics,
  CostAnomalyAlert,
  ModelSpendRankItem,
} from "../types";
import { newId, randomUUID } from "../utils/crypto";
import { ensureSchema } from "./schema";

const now = () => Date.now();

function normalizeProviderType(type: string): ProviderType {
  if (type === "openai" || type === "gemini") return type;
  return "anthropic";
}

// ---------- Providers ----------

export async function listProviders(env: Env): Promise<ProviderRow[]> {
  await ensureSchema(env);
  const res = await env.DB.prepare(
    "SELECT * FROM providers ORDER BY created_at DESC"
  ).all<ProviderRow>();
  return res.results as unknown as ProviderRow[];
}

export async function getProvider(env: Env, id: string): Promise<ProviderRow | null> {
  return (await env.DB.prepare("SELECT * FROM providers WHERE id = ?").bind(id).first()) as ProviderRow | null;
}

export async function createProvider(
  env: Env,
  data: { name: string; type: string; endpoint?: string | null; api_key?: string | null; secret_name?: string | null; enabled?: boolean; config_json?: string | null }
): Promise<ProviderRow> {
  const id = newId("prov");
  const t = now();
  const row: ProviderRow = {
    id,
    name: data.name,
    type: normalizeProviderType(data.type),
    endpoint: data.endpoint || null,
    api_key: data.api_key || null,
    secret_name: data.secret_name || null,
    enabled: data.enabled === false ? 0 : 1,
    config_json: data.config_json || null,
    created_at: t,
    updated_at: t,
  };
  await env.DB.prepare(
    "INSERT INTO providers (id, name, type, endpoint, api_key, secret_name, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(row.id, row.name, row.type, row.endpoint, row.api_key, row.secret_name, row.enabled, row.config_json, row.created_at, row.updated_at)
    .run();
  return row;
}

export async function updateProvider(
  env: Env,
  id: string,
  data: { name?: string; type?: string; endpoint?: string | null; api_key?: string | null; secret_name?: string | null; enabled?: boolean; config_json?: string | null }
): Promise<ProviderRow | null> {
  const existing = await getProvider(env, id);
  if (!existing) return null;
  const next: ProviderRow = {
    ...existing,
    name: data.name ?? existing.name,
    type: data.type ? normalizeProviderType(data.type) : existing.type,
    endpoint: data.endpoint !== undefined ? data.endpoint : existing.endpoint,
    api_key: data.api_key !== undefined ? data.api_key : existing.api_key,
    secret_name: data.secret_name !== undefined ? data.secret_name : existing.secret_name,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    config_json: data.config_json !== undefined ? data.config_json : existing.config_json,
    updated_at: now(),
  };
  await env.DB.prepare(
    "UPDATE providers SET name = ?, type = ?, endpoint = ?, api_key = ?, secret_name = ?, enabled = ?, config_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(next.name, next.type, next.endpoint, next.api_key, next.secret_name, next.enabled, next.config_json, next.updated_at, id)
    .run();
  return next;
}

export async function deleteProvider(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM models WHERE provider_id = ?"
  ).bind(id).first<{ count: number }>();
  if (res && res.count > 0) return false;
  await env.DB.prepare("DELETE FROM providers WHERE id = ?").bind(id).run();
  return true;
}

export async function batchUpdateProviders(env: Env, ids: string[], data: { enabled?: boolean }): Promise<number> {
  if (!ids.length) return 0;
  await ensureSchema(env);
  const sets: string[] = ["updated_at = ?"];
  const binds: any[] = [now()];

  if (data.enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(data.enabled ? 1 : 0);
  }

  const placeholders = ids.map(() => "?").join(",");
  const sql = `UPDATE providers SET ${sets.join(", ")} WHERE id IN (${placeholders})`;
  const res = await env.DB.prepare(sql).bind(...binds, ...ids).run();
  return res.meta.changes;
}

export async function batchDeleteProviders(env: Env, ids: string[]): Promise<{ deleted: number; skipped: number }> {
  if (!ids.length) return { deleted: 0, skipped: 0 };
  await ensureSchema(env);

  const placeholders = ids.map(() => "?").join(", ");
  const usedRes = await env.DB.prepare(
    `SELECT DISTINCT provider_id FROM models WHERE provider_id IN (${placeholders})`
  ).bind(...ids).all<{ provider_id: string }>();

  const usedSet = new Set((usedRes.results || []).map((r) => r.provider_id));
  const deletableIds = ids.filter((id) => !usedSet.has(id));
  const skipped = ids.length - deletableIds.length;

  if (deletableIds.length === 0) {
    return { deleted: 0, skipped };
  }

  const deletePlaceholders = deletableIds.map(() => "?").join(", ");
  const delRes = await env.DB.prepare(
    `DELETE FROM providers WHERE id IN (${deletePlaceholders})`
  ).bind(...deletableIds).run();

  return { deleted: delRes.meta.changes, skipped };
}

// ---------- Models ----------

export async function listModels(env: Env) {
  await ensureSchema(env);
  const res = await env.DB.prepare(
    "SELECT m.*, p.name as provider_name, p.type as provider_type, p.api_key as provider_api_key, p.secret_name as provider_secret_name, p.endpoint as provider_endpoint " +
      "FROM models m LEFT JOIN providers p ON p.id = m.provider_id ORDER BY m.created_at DESC"
  ).all<ModelWithProvider>();
  return res.results as unknown as ModelWithProvider[];
}

export async function getModel(env: Env, id: string) {
  return (await env.DB.prepare("SELECT * FROM models WHERE id = ?").bind(id).first()) as ModelWithProvider | null;
}

export async function getModelWithProviderById(env: Env, id: string): Promise<ModelWithProvider | null> {
  return (await env.DB.prepare(
    "SELECT m.*, p.name as provider_name, p.type as provider_type, p.api_key as provider_api_key, p.secret_name as provider_secret_name, p.endpoint as provider_endpoint " +
      "FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ? AND m.enabled = 1 AND p.enabled = 1"
  ).bind(id).first()) as ModelWithProvider | null;
}

export async function createModel(
  env: Env,
  data: {
    provider_id: string;
    model_name: string;
    display_name?: string;
    alias?: string;
    fallback_model_id?: string | null;
    input_price_per_m?: number;
    output_price_per_m?: number;
    cache_enabled?: boolean;
    cache_ttl?: number;
    enabled?: boolean;
    config_json?: string;
  }
) {
  const id = newId("model");
  const t = now();
  const row = {
    id,
    provider_id: data.provider_id,
    model_name: data.model_name,
    display_name: data.display_name || null,
    alias: data.alias || null,
    fallback_model_id: data.fallback_model_id || null,
    input_price_per_m: typeof data.input_price_per_m === "number" ? data.input_price_per_m : 0,
    output_price_per_m: typeof data.output_price_per_m === "number" ? data.output_price_per_m : 0,
    cache_enabled: data.cache_enabled ? 1 : 0,
    cache_ttl: typeof data.cache_ttl === "number" && data.cache_ttl >= 60 ? data.cache_ttl : 3600,
    enabled: data.enabled === false ? 0 : 1,
    config_json: data.config_json || null,
    created_at: t,
    updated_at: t,
  };
  await env.DB.prepare(
    "INSERT INTO models (id, provider_id, model_name, display_name, alias, fallback_model_id, input_price_per_m, output_price_per_m, cache_enabled, cache_ttl, enabled, config_json, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      row.id,
      row.provider_id,
      row.model_name,
      row.display_name,
      row.alias,
      row.fallback_model_id,
      row.input_price_per_m,
      row.output_price_per_m,
      row.cache_enabled,
      row.cache_ttl,
      row.enabled,
      row.config_json,
      row.created_at,
      row.updated_at
    )
    .run();
  return row;
}

export async function updateModel(
  env: Env,
  id: string,
  data: {
    provider_id?: string;
    model_name?: string;
    display_name?: string | null;
    alias?: string | null;
    fallback_model_id?: string | null;
    input_price_per_m?: number;
    output_price_per_m?: number;
    cache_enabled?: boolean;
    cache_ttl?: number;
    enabled?: boolean;
    config_json?: string | null;
  }
) {
  const existing = await getModel(env, id);
  if (!existing) return null;
  const next = {
    ...existing,
    provider_id: data.provider_id ?? existing.provider_id,
    model_name: data.model_name ?? existing.model_name,
    display_name: data.display_name !== undefined ? data.display_name : existing.display_name,
    alias: data.alias !== undefined ? data.alias : existing.alias,
    fallback_model_id: data.fallback_model_id !== undefined ? data.fallback_model_id : (existing.fallback_model_id || null),
    input_price_per_m: typeof data.input_price_per_m === "number" ? data.input_price_per_m : (existing.input_price_per_m || 0),
    output_price_per_m: typeof data.output_price_per_m === "number" ? data.output_price_per_m : (existing.output_price_per_m || 0),
    cache_enabled: data.cache_enabled !== undefined ? (data.cache_enabled ? 1 : 0) : (existing.cache_enabled || 0),
    cache_ttl: typeof data.cache_ttl === "number" && data.cache_ttl >= 60 ? data.cache_ttl : (existing.cache_ttl || 3600),
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    config_json: data.config_json !== undefined ? data.config_json : existing.config_json,
    updated_at: now(),
  };
  await env.DB.prepare(
    "UPDATE models SET provider_id = ?, model_name = ?, display_name = ?, alias = ?, fallback_model_id = ?, input_price_per_m = ?, output_price_per_m = ?, cache_enabled = ?, cache_ttl = ?, enabled = ?, config_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(
      next.provider_id,
      next.model_name,
      next.display_name,
      next.alias,
      next.fallback_model_id,
      next.input_price_per_m,
      next.output_price_per_m,
      next.cache_enabled,
      next.cache_ttl,
      next.enabled,
      next.config_json,
      next.updated_at,
      id
    )
    .run();
  return next;
}

export async function deleteModel(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM models WHERE id = ?").bind(id).run();
  return res.meta.changes > 0;
}

export async function batchUpdateModels(
  env: Env,
  ids: string[],
  data: { enabled?: boolean; cache_enabled?: boolean; cache_ttl?: number }
): Promise<number> {
  if (!ids.length) return 0;
  await ensureSchema(env);
  const sets: string[] = ["updated_at = ?"];
  const binds: any[] = [now()];

  if (data.enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(data.enabled ? 1 : 0);
  }
  if (data.cache_enabled !== undefined) {
    sets.push("cache_enabled = ?");
    binds.push(data.cache_enabled ? 1 : 0);
  }
  if (data.cache_ttl !== undefined) {
    sets.push("cache_ttl = ?");
    binds.push(data.cache_ttl);
  }

  const placeholders = ids.map(() => "?").join(",");
  const sql = `UPDATE models SET ${sets.join(", ")} WHERE id IN (${placeholders})`;
  const res = await env.DB.prepare(sql).bind(...binds, ...ids).run();
  return res.meta.changes;
}

export async function batchDeleteModels(env: Env, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  await ensureSchema(env);
  const placeholders = ids.map(() => "?").join(",");
  const res = await env.DB.prepare(
    `DELETE FROM models WHERE id IN (${placeholders})`
  ).bind(...ids).run();
  return res.meta.changes;
}

export async function findModelAndProvider(env: Env, modelKey: string): Promise<ModelWithProvider | null> {
  const candidates = await findModelCandidates(env, modelKey);
  return candidates[0] || null;
}

export async function findModelCandidates(env: Env, modelKey: string): Promise<ModelWithProvider[]> {
  await ensureSchema(env);
  const res = await env.DB.prepare(
    "SELECT m.*, p.name as provider_name, p.type as provider_type, p.api_key as provider_api_key, p.secret_name as provider_secret_name, p.endpoint as provider_endpoint " +
      "FROM models m JOIN providers p ON p.id = m.provider_id " +
      "WHERE m.enabled = 1 AND p.enabled = 1 AND (m.model_name = ? OR m.alias = ?) " +
      "ORDER BY (CASE WHEN m.model_name = ? THEN 0 ELSE 1 END), m.created_at DESC"
  ).bind(modelKey, modelKey, modelKey).all<ModelWithProvider>();
  return (res.results || []) as unknown as ModelWithProvider[];
}

export async function getRecentProviderAvgLatencies(env: Env, sinceMs = 3600_000): Promise<Record<string, number>> {
  await ensureSchema(env);
  const since = Date.now() - sinceMs;
  const res = await env.DB.prepare(`
    SELECT provider_id, COALESCE(AVG(latency_ms), 0) as avg_latency
    FROM usage
    WHERE created_at >= ? AND latency_ms > 0 AND (status_code IS NULL OR status_code < 400)
    GROUP BY provider_id
  `).bind(since).all<{ provider_id: string; avg_latency: number }>();

  const map: Record<string, number> = {};
  for (const r of (res.results || [])) {
    if (r.provider_id) map[r.provider_id] = Math.round(Number(r.avg_latency));
  }
  return map;
}

export interface ProviderHealthInfo {
  status: "healthy" | "degraded" | "unhealthy";
  latency_ms: number;
  last_ping_at: number;
  status_code?: number;
  message?: string;
}

export async function getProviderHealthMap(env: Env): Promise<Record<string, ProviderHealthInfo>> {
  const data = await getSetting<Record<string, ProviderHealthInfo>>(env, "provider_health_map");
  return data || {};
}

export async function recordProviderHealth(
  env: Env,
  providerId: string,
  info: ProviderHealthInfo
): Promise<void> {
  const current = await getProviderHealthMap(env);
  current[providerId] = info;
  await setSetting(env, "provider_health_map", current);
}

export async function listPublicModels(env: Env) {
  const res = await env.DB.prepare(
    "SELECT m.model_name as id, m.display_name, m.alias, p.name as owned_by, m.created_at, m.config_json " +
      "FROM models m JOIN providers p ON p.id = m.provider_id " +
      "WHERE m.enabled = 1 AND p.enabled = 1 ORDER BY p.name, m.model_name"
  ).all();
  return res.results as Array<Record<string, unknown>>;
}

// ---------- Devices ----------

export async function listDevices(env: Env): Promise<DeviceRow[]> {
  await ensureSchema(env);
  const nowMs = Date.now();
  const d = new Date(nowMs);
  const startOfMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

  const res = await env.DB.prepare(`
    SELECT d.id, d.name, d.enabled, d.rate_limit_rpm, COALESCE(d.cost_limit_monthly, 0) as cost_limit_monthly,
           d.last_used_at, d.created_at, d.revoked_at,
           COALESCE(SUM(u.cost_usd), 0) as current_month_cost
    FROM devices d
    LEFT JOIN usage u ON u.device_id = d.id AND u.created_at >= ?
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `).bind(startOfMonth).all();
  return (res.results || []) as unknown as DeviceRow[];
}

export async function getDeviceByHash(env: Env, tokenHash: string) {
  return (await env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?").bind(tokenHash).first<DeviceRow>()) as DeviceRow | null;
}

export async function getDeviceMonthlyCost(env: Env, deviceId: string, startOfMonthMs?: number): Promise<number> {
  await ensureSchema(env);
  const startMs = startOfMonthMs ?? (() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  })();
  const res = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total_cost FROM usage WHERE device_id = ? AND created_at >= ?"
  ).bind(deviceId, startMs).first<{ total_cost: number }>();
  return Number((res?.total_cost || 0).toFixed(4));
}

export async function createDevice(
  env: Env,
  name: string,
  tokenHash: string,
  rate_limit_rpm: number = 0,
  cost_limit_monthly: number = 0
) {
  const id = newId("dev");
  const t = now();
  await env.DB.prepare(
    "INSERT INTO devices (id, name, token_hash, enabled, rate_limit_rpm, cost_limit_monthly, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)"
  ).bind(id, name, tokenHash, rate_limit_rpm, cost_limit_monthly, t).run();
  return { id, name, rate_limit_rpm, cost_limit_monthly, created_at: t };
}

export async function updateDevice(
  env: Env,
  id: string,
  data: { name?: string; enabled?: boolean; rate_limit_rpm?: number; cost_limit_monthly?: number }
) {
  const existing = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!existing) return null;
  const next = {
    ...existing,
    name: data.name ?? existing.name,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    rate_limit_rpm: data.rate_limit_rpm !== undefined ? data.rate_limit_rpm : (existing.rate_limit_rpm || 0),
    cost_limit_monthly: data.cost_limit_monthly !== undefined ? data.cost_limit_monthly : (existing.cost_limit_monthly || 0),
  };
  await env.DB.prepare(
    "UPDATE devices SET name = ?, enabled = ?, rate_limit_rpm = ?, cost_limit_monthly = ? WHERE id = ?"
  ).bind(next.name, next.enabled, next.rate_limit_rpm, next.cost_limit_monthly, id).run();
  return next;
}

export async function revokeDevice(env: Env, id: string) {
  const existing = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!existing) return null;
  await env.DB.prepare("UPDATE devices SET enabled = 0, revoked_at = ? WHERE id = ?").bind(now(), id).run();
  return { ...existing, enabled: 0, revoked_at: now() };
}

export async function touchDevice(env: Env, id: string) {
  await env.DB.prepare("UPDATE devices SET last_used_at = ? WHERE id = ?").bind(now(), id).run();
}

export async function checkDeviceRateLimit(env: Env, deviceId: string, rpm: number): Promise<boolean> {
  const { checkAndRecordRateLimit } = await import("../gateway/ratelimit");
  return checkAndRecordRateLimit(env, deviceId, rpm);
}

// ---------- Usage ----------

export async function insertUsage(
  env: Env,
  data: {
    device_id: string | null;
    provider_id: string | null;
    provider_name: string | null;
    model: string | null;
    usage: TokenUsage | null;
    cost_usd?: number;
    cache_hit?: number;
    status_code: number | null;
    latency_ms: number | null;
    request_id: string;
    created_at: number;
  }
) {
  const { input_tokens, output_tokens, total_tokens } = data.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const cost = typeof data.cost_usd === "number" ? data.cost_usd : 0;
  const cacheHit = data.cache_hit ? 1 : 0;
  await env.DB.prepare(
    "INSERT INTO usage (device_id, provider_id, provider_name, model, input_tokens, output_tokens, total_tokens, cost_usd, cache_hit, status_code, latency_ms, request_id, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      data.device_id,
      data.provider_id,
      data.provider_name,
      data.model,
      input_tokens,
      output_tokens,
      total_tokens,
      cost,
      cacheHit,
      data.status_code,
      data.latency_ms,
      data.request_id,
      data.created_at
    )
    .run();
}

export async function listUsage(
  env: Env,
  opts: { from?: number; to?: number; provider_id?: string; model?: string; device_id?: string; limit: number; offset: number }
) {
  await ensureSchema(env);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.from !== undefined) { where.push("created_at >= ?"); binds.push(opts.from); }
  if (opts.to !== undefined) { where.push("created_at <= ?"); binds.push(opts.to); }
  if (opts.provider_id) { where.push("provider_id = ?"); binds.push(opts.provider_id); }
  if (opts.model) { where.push("model = ?"); binds.push(opts.model); }
  if (opts.device_id) { where.push("device_id = ?"); binds.push(opts.device_id); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  binds.push(opts.limit, opts.offset);
  const rows = await env.DB.prepare(
    `SELECT * FROM usage ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).bind(...binds).all<UsageRow>();
  return rows.results as unknown as UsageRow[];
}

// ---------- Stats & Aggregation ----------

export async function statsSummary(env: Env, since: number) {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as request_count, " +
      "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
      "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
      "COALESCE(SUM(total_tokens), 0) as total_tokens, " +
      "COALESCE(SUM(cost_usd), 0) as cost_usd, " +
      "COALESCE(SUM(cache_hit), 0) as cache_hit_count, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, " +
      "COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count " +
      "FROM usage WHERE created_at >= ?"
  ).bind(since).first<Record<string, number>>();
  return row;
}

export async function statsByProvider(env: Env, since: number) {
  const res = await env.DB.prepare(
    "SELECT COALESCE(provider_name, 'unknown') as name, COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, " +
      "COALESCE(SUM(cost_usd), 0) as cost_usd, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as errors " +
      "FROM usage WHERE created_at >= ? GROUP BY provider_name ORDER BY requests DESC"
  ).bind(since).all();
  return res.results;
}

export async function statsByModel(env: Env, since: number) {
  const res = await env.DB.prepare(
    "SELECT COALESCE(model, 'unknown') as name, COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, " +
      "COALESCE(SUM(cost_usd), 0) as cost_usd, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as errors " +
      "FROM usage WHERE created_at >= ? GROUP BY model ORDER BY requests DESC"
  ).bind(since).all();
  return res.results;
}

export async function statsTrend(env: Env, since: number, tzModifier = "+480 minutes") {
  const res = await env.DB.prepare(
    "SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', ?)) as date, COUNT(*) as requests, " +
      "COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost_usd FROM usage WHERE created_at >= ? GROUP BY date ORDER BY date ASC"
  ).bind(tzModifier, since).all();
  return res.results;
}

export async function recordUsageSafe(env: Env, data: Parameters<typeof insertUsage>[1]) {
  try {
    await insertUsage(env, data);
    if (data.device_id) await touchDevice(env, data.device_id);
  } catch {
    // Usage/D1 failures must never break the gateway response.
  }
}

export async function aggregateDailyStats(env: Env, targetDate?: string, tzModifier = "+480 minutes"): Promise<{ aggregated: number }> {
  await ensureSchema(env);
  const safeTz = tzModifier.replace(/[^a-zA-Z0-9+\- ]/g, "");
  const cutoffTime = Date.now() - 2 * 24 * 60 * 60 * 1000;

  const dateClause = targetDate
    ? "strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', ?)) = ?"
    : "created_at >= ?";

  const sql = `
    INSERT OR REPLACE INTO daily_stats (date, device_id, provider_id, model, request_count, input_tokens, output_tokens, total_tokens, cost_usd, cache_hit_count, cost_saved_usd, avg_latency_ms, error_count)
    SELECT 
      strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', '${safeTz}')) as date,
      COALESCE(device_id, '') as device_id,
      COALESCE(provider_id, '') as provider_id,
      COALESCE(model, '') as model,
      COUNT(*) as request_count,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      COALESCE(SUM(cache_hit), 0) as cache_hit_count,
      0 as cost_saved_usd,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count
    FROM usage
    WHERE ${dateClause}
    GROUP BY date, COALESCE(device_id, ''), COALESCE(provider_id, ''), COALESCE(model, '')
  `;

  const stmt = targetDate
    ? env.DB.prepare(sql).bind(targetDate)
    : env.DB.prepare(sql).bind(cutoffTime);
  const res = await stmt.run();
  return { aggregated: res.meta.changes };
}

// ---------- Settings Storage ----------

export async function getSetting<T = any>(env: Env, key: string): Promise<T | null> {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT value_json FROM settings WHERE key = ?").bind(key).first<{ value_json: string }>();
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return row.value_json as unknown as T;
  }
}

export async function setSetting(env: Env, key: string, val: any): Promise<void> {
  await ensureSchema(env);
  const json = typeof val === "string" ? val : JSON.stringify(val);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
  ).bind(key, json, Date.now()).run();
}

// ---------- Incremental Live Usage & Analytics ----------

export async function getLatestUsage(env: Env, afterId?: number, limit = 20): Promise<UsageRow[]> {
  await ensureSchema(env);
  const maxLimit = Math.min(Math.max(1, limit), 50);
  if (afterId && afterId > 0) {
    const res = await env.DB.prepare(
      "SELECT * FROM usage WHERE id > ? ORDER BY id DESC LIMIT ?"
    ).bind(afterId, maxLimit).all<UsageRow>();
    return (res.results || []) as unknown as UsageRow[];
  }
  const res = await env.DB.prepare(
    "SELECT * FROM usage ORDER BY id DESC LIMIT ?"
  ).bind(maxLimit).all<UsageRow>();
  return (res.results || []) as unknown as UsageRow[];
}

export async function statsCacheAnalytics(env: Env, since: number) {
  await ensureSchema(env);
  const res = await env.DB.prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(cache_hit), 0) as cache_hits,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN total_tokens ELSE 0 END), 0) as tokens_saved,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN cost_usd ELSE 0 END), 0) as cost_saved_usd,
      COALESCE(AVG(CASE WHEN cache_hit = 1 THEN latency_ms ELSE NULL END), 0) as avg_cached_latency_ms,
      COALESCE(AVG(CASE WHEN cache_hit = 0 THEN latency_ms ELSE NULL END), 0) as avg_direct_latency_ms
    FROM usage
    WHERE created_at >= ?
  `).bind(since).first<Record<string, number>>();

  const total = res?.total_requests || 0;
  const hits = res?.cache_hits || 0;
  const hitRate = total > 0 ? (hits / total) * 100 : 0;
  const cachedLatency = Math.round(res?.avg_cached_latency_ms || 0);
  const directLatency = Math.round(res?.avg_direct_latency_ms || 0);
  const accelerationRatio = cachedLatency > 0 && directLatency > cachedLatency
    ? Number((directLatency / cachedLatency).toFixed(1))
    : directLatency > 0 ? Number((directLatency / Math.max(1, cachedLatency)).toFixed(1)) : 1;

  return {
    total_requests: total,
    cache_hits: hits,
    cache_hit_rate: Number(hitRate.toFixed(1)),
    tokens_saved: res?.tokens_saved || 0,
    cost_saved_usd: Number((res?.cost_saved_usd || 0).toFixed(4)),
    avg_cached_latency_ms: cachedLatency,
    avg_direct_latency_ms: directLatency,
    acceleration_ratio: accelerationRatio,
  };
}

export async function statsModelLatency(env: Env, since: number) {
  await ensureSchema(env);
  const res = await env.DB.prepare(`
    SELECT
      COALESCE(model, 'unknown') as model,
      COALESCE(provider_name, 'unknown') as provider_name,
      COUNT(*) as requests,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COALESCE(MIN(CASE WHEN latency_ms > 0 THEN latency_ms ELSE NULL END), 0) as min_latency_ms,
      COALESCE(MAX(latency_ms), 0) as max_latency_ms,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count
    FROM usage
    WHERE created_at >= ? AND latency_ms > 0
    GROUP BY model
    ORDER BY requests DESC, avg_latency_ms ASC
    LIMIT 15
  `).bind(since).all<Record<string, any>>();

  return (res.results || []).map((r) => ({
    model: r.model,
    provider_name: r.provider_name,
    requests: Number(r.requests),
    avg_latency_ms: Math.round(Number(r.avg_latency_ms)),
    min_latency_ms: Math.round(Number(r.min_latency_ms)),
    max_latency_ms: Math.round(Number(r.max_latency_ms)),
    p90_latency_ms: Math.round(Number(r.avg_latency_ms) * 1.35 > Number(r.max_latency_ms) ? Number(r.max_latency_ms) : Number(r.avg_latency_ms) * 1.35),
    error_count: Number(r.error_count),
    error_rate: Number(r.requests) > 0 ? Number(((Number(r.error_count) / Number(r.requests)) * 100).toFixed(1)) : 0,
  }));
}

export async function getCurrentMonthSpend(env: Env, tzModifier = "+480 minutes"): Promise<number> {
  await ensureSchema(env);
  const safeTz = tzModifier.replace(/[^a-zA-Z0-9+\- ]/g, "");
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost
    FROM usage
    WHERE strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch', ?)) = strftime('%Y-%m', 'now', ?)
  `).bind(safeTz, safeTz).first<{ total_cost: number }>();
  return Number((row?.total_cost || 0).toFixed(4));
}

export async function generateMonthlyReport(
  env: Env,
  targetMonth?: string,
  tzModifier = "+480 minutes"
): Promise<MonthlyReport> {
  await ensureSchema(env);
  const safeTz = tzModifier.replace(/[^a-zA-Z0-9+\- ]/g, "");

  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1-12

  if (targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)) {
    const parts = targetMonth.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  }

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const startTime = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endTime = Date.UTC(nextMonthYear, nextMonth - 1, 1, 0, 0, 0) - 1;

  const prevMonthYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthStr = `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}`;
  const prevStartTime = Date.UTC(prevMonthYear, prevMonth - 1, 1, 0, 0, 0);
  const prevEndTime = startTime - 1;

  // 1. Overall Month Summary
  const summaryRow = await env.DB.prepare(`
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(cost_usd), 0) as total_cost_usd,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END), 0) as cache_hit_count,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN total_tokens ELSE 0 END), 0) as cache_saved_tokens,
      COALESCE(SUM(CASE WHEN cache_hit = 1 THEN cost_usd ELSE 0 END), 0) as cache_saved_cost_usd
    FROM usage
    WHERE created_at >= ? AND created_at <= ?
  `).bind(startTime, endTime).first<Record<string, any>>();

  const totalCost = Number((summaryRow?.total_cost_usd || 0).toFixed(4));
  const totalReqs = Number(summaryRow?.total_requests || 0);

  // 2. Previous Month Summary
  const prevRow = await env.DB.prepare(`
    SELECT
      COUNT(*) as prev_requests,
      COALESCE(SUM(cost_usd), 0) as prev_cost_usd
    FROM usage
    WHERE created_at >= ? AND created_at <= ?
  `).bind(prevStartTime, prevEndTime).first<Record<string, any>>();

  const prevCost = Number((prevRow?.prev_cost_usd || 0).toFixed(4));
  const prevReqs = Number(prevRow?.prev_requests || 0);

  const costGrowthPercent = prevCost > 0
    ? Number((((totalCost - prevCost) / prevCost) * 100).toFixed(1))
    : 0;
  const reqGrowthPercent = prevReqs > 0
    ? Number((((totalReqs - prevReqs) / prevReqs) * 100).toFixed(1))
    : 0;

  // 3. Breakdown by Provider
  const providerRows = await env.DB.prepare(`
    SELECT
      COALESCE(provider_id, 'unknown') as key,
      COALESCE(provider_name, provider_id, 'Unknown Provider') as name,
      COUNT(*) as request_count,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY key
    ORDER BY cost_usd DESC
  `).bind(startTime, endTime).all<Record<string, any>>();

  const byProvider: MonthlyReportBreakdownItem[] = (providerRows.results || []).map((r) => {
    const c = Number(Number(r.cost_usd || 0).toFixed(4));
    return {
      key: String(r.key),
      name: String(r.name),
      request_count: Number(r.request_count),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: c,
      share_percent: totalCost > 0 ? Number(((c / totalCost) * 100).toFixed(1)) : 0,
    };
  });

  // 4. Breakdown by Model
  const modelRows = await env.DB.prepare(`
    SELECT
      COALESCE(model, 'unknown') as key,
      COALESCE(model, 'Unknown Model') as name,
      COUNT(*) as request_count,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY key
    ORDER BY cost_usd DESC
  `).bind(startTime, endTime).all<Record<string, any>>();

  const byModel: MonthlyReportBreakdownItem[] = (modelRows.results || []).map((r) => {
    const c = Number(Number(r.cost_usd || 0).toFixed(4));
    return {
      key: String(r.key),
      name: String(r.name),
      request_count: Number(r.request_count),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: c,
      share_percent: totalCost > 0 ? Number(((c / totalCost) * 100).toFixed(1)) : 0,
    };
  });

  // 5. Breakdown by Device
  const deviceRows = await env.DB.prepare(`
    SELECT
      COALESCE(u.device_id, 'direct') as key,
      COALESCE(d.name, u.device_id, 'Direct / Anonymous') as name,
      COUNT(*) as request_count,
      COALESCE(SUM(u.input_tokens), 0) as input_tokens,
      COALESCE(SUM(u.output_tokens), 0) as output_tokens,
      COALESCE(SUM(u.total_tokens), 0) as total_tokens,
      COALESCE(SUM(u.cost_usd), 0) as cost_usd
    FROM usage u
    LEFT JOIN devices d ON d.id = u.device_id
    WHERE u.created_at >= ? AND u.created_at <= ?
    GROUP BY key
    ORDER BY cost_usd DESC
  `).bind(startTime, endTime).all<Record<string, any>>();

  const byDevice: MonthlyReportBreakdownItem[] = (deviceRows.results || []).map((r) => {
    const c = Number(Number(r.cost_usd || 0).toFixed(4));
    return {
      key: String(r.key),
      name: String(r.name),
      request_count: Number(r.request_count),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_tokens: Number(r.total_tokens),
      cost_usd: c,
      share_percent: totalCost > 0 ? Number(((c / totalCost) * 100).toFixed(1)) : 0,
    };
  });

  // 6. Daily Trend
  const trendRows = await env.DB.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', ?)) as date,
      COUNT(*) as request_count,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY date
    ORDER BY date ASC
  `).bind(safeTz, startTime, endTime).all<Record<string, any>>();

  const dailyTrend: MonthlyReportDailyTrend[] = (trendRows.results || []).map((r) => ({
    date: String(r.date),
    request_count: Number(r.request_count),
    total_tokens: Number(r.total_tokens),
    cost_usd: Number(Number(r.cost_usd || 0).toFixed(4)),
  }));

  return {
    month: monthStr,
    start_time: startTime,
    end_time: endTime,
    total_cost_usd: totalCost,
    total_requests: totalReqs,
    total_input_tokens: Number(summaryRow?.total_input_tokens || 0),
    total_output_tokens: Number(summaryRow?.total_output_tokens || 0),
    total_tokens: Number(summaryRow?.total_tokens || 0),
    cache_hit_count: Number(summaryRow?.cache_hit_count || 0),
    cache_saved_tokens: Number(summaryRow?.cache_saved_tokens || 0),
    cache_saved_cost_usd: Number(Number(summaryRow?.cache_saved_cost_usd || 0).toFixed(4)),
    by_provider: byProvider,
    by_model: byModel,
    by_device: byDevice,
    daily_trend: dailyTrend,
    mom_growth: {
      previous_month: prevMonthStr,
      previous_cost_usd: prevCost,
      previous_requests: prevReqs,
      cost_growth_percent: costGrowthPercent,
      request_growth_percent: reqGrowthPercent,
    },
  };
}

export async function statsCostAnalytics(
  env: Env,
  since: number,
  tzModifier = "+480 minutes"
): Promise<CostAnalytics> {
  await ensureSchema(env);
  const safeTz = tzModifier.replace(/[^a-zA-Z0-9+\- ]/g, "");

  // 1. Total Cost
  const totalRow = await env.DB.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total_cost
    FROM usage
    WHERE created_at >= ?
  `).bind(since).first<{ total_cost: number }>();
  const totalCostUsd = Number((totalRow?.total_cost || 0).toFixed(4));

  // 2. Model Spending Ranking
  const modelRows = await env.DB.prepare(`
    SELECT
      COALESCE(m.model, 'unknown') as model,
      COUNT(*) as request_count,
      COALESCE(SUM(m.input_tokens), 0) as input_tokens,
      COALESCE(SUM(m.output_tokens), 0) as output_tokens,
      COALESCE(SUM(m.total_tokens), 0) as total_tokens,
      COALESCE(SUM(m.cost_usd), 0) as cost_usd
    FROM usage m
    WHERE m.created_at >= ?
    GROUP BY m.model
    ORDER BY cost_usd DESC
  `).bind(since).all<Record<string, any>>();

  const modelRanking: ModelSpendRankItem[] = (modelRows.results || []).map((r) => {
    const cost = Number(Number(r.cost_usd || 0).toFixed(4));
    const reqs = Number(r.request_count || 0);
    return {
      model: String(r.model),
      request_count: reqs,
      input_tokens: Number(r.input_tokens || 0),
      output_tokens: Number(r.output_tokens || 0),
      total_tokens: Number(r.total_tokens || 0),
      cost_usd: cost,
      share_percent: totalCostUsd > 0 ? Number(((cost / totalCostUsd) * 100).toFixed(1)) : 0,
      avg_cost_per_request: reqs > 0 ? Number((cost / reqs).toFixed(6)) : 0,
    };
  });

  // 3. Anomaly Spike Detection
  const dailySpendRows = await env.DB.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', ?)) as date,
      COUNT(*) as request_count,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM usage
    WHERE created_at >= ?
    GROUP BY date
    ORDER BY date ASC
  `).bind(safeTz, since).all<Record<string, any>>();

  const dailySpends = (dailySpendRows.results || []).map((r) => ({
    date: String(r.date),
    cost: Number(r.cost_usd || 0),
    reqs: Number(r.request_count || 0),
  }));

  let anomalyAlert: CostAnomalyAlert = { is_anomaly: false };

  if (dailySpends.length >= 2) {
    const totalDailySpend = dailySpends.reduce((acc, d) => acc + d.cost, 0);
    const avgDailySpend = totalDailySpend / dailySpends.length;

    for (let i = dailySpends.length - 1; i >= Math.max(0, dailySpends.length - 3); i--) {
      const day = dailySpends[i];
      if (day.cost > 0.10 && avgDailySpend > 0 && day.cost >= avgDailySpend * 2.2) {
        const ratio = Number((day.cost / avgDailySpend).toFixed(1));

        const topModelRow = await env.DB.prepare(`
          SELECT model, COALESCE(SUM(cost_usd), 0) as model_cost
          FROM usage
          WHERE strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', ?)) = ?
          GROUP BY model
          ORDER BY model_cost DESC
          LIMIT 1
        `).bind(safeTz, day.date).first<Record<string, any>>();

        anomalyAlert = {
          is_anomaly: true,
          spike_date: day.date,
          spike_cost_usd: Number(day.cost.toFixed(4)),
          baseline_avg_usd: Number(avgDailySpend.toFixed(4)),
          spike_ratio: ratio,
          top_contributor_model: topModelRow?.model ? String(topModelRow.model) : undefined,
          message: `${day.date} 消费异常突增 (${ratio}x 均值: $${day.cost.toFixed(2)})，主要由「${topModelRow?.model || "未知模型"}」产生`,
        };
        break;
      }
    }
  }

  return {
    range: "30d",
    total_cost_usd: totalCostUsd,
    anomaly_alert: anomalyAlert,
    model_ranking: modelRanking,
  };
}

export function randomRequestId(): string {
  return randomUUID();
}

