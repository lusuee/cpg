import type { DeviceRow, Env, ModelWithProvider, ProviderRow, TokenUsage, UsageRow } from "../types";
import { newId, randomUUID } from "../utils/crypto";

const now = () => Date.now();

// ---------- Providers ----------

export async function listProviders(env: Env): Promise<ProviderRow[]> {
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
  data: { name: string; type: string; endpoint?: string; secret_name?: string; enabled?: boolean; config_json?: string }
): Promise<ProviderRow> {
  const id = newId("prov");
  const t = now();
  const row: ProviderRow = {
    id,
    name: data.name,
    type: data.type === "openai" ? "openai" : "anthropic",
    endpoint: data.endpoint || null,
    secret_name: data.secret_name || null,
    enabled: data.enabled === false ? 0 : 1,
    config_json: data.config_json || null,
    created_at: t,
    updated_at: t,
  };
  await env.DB.prepare(
    "INSERT INTO providers (id, name, type, endpoint, secret_name, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(row.id, row.name, row.type, row.endpoint, row.secret_name, row.enabled, row.config_json, row.created_at, row.updated_at)
    .run();
  return row;
}

export async function updateProvider(
  env: Env,
  id: string,
  data: { name?: string; type?: string; endpoint?: string | null; secret_name?: string | null; enabled?: boolean; config_json?: string | null }
): Promise<ProviderRow | null> {
  const existing = await getProvider(env, id);
  if (!existing) return null;
  const next: ProviderRow = {
    ...existing,
    name: data.name ?? existing.name,
    type: (data.type === "openai" || data.type === "anthropic" ? data.type : existing.type) as ProviderRow["type"],
    endpoint: data.endpoint !== undefined ? data.endpoint : existing.endpoint,
    secret_name: data.secret_name !== undefined ? data.secret_name : existing.secret_name,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    config_json: data.config_json !== undefined ? data.config_json : existing.config_json,
    updated_at: now(),
  };
  await env.DB.prepare(
    "UPDATE providers SET name = ?, type = ?, endpoint = ?, secret_name = ?, enabled = ?, config_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(next.name, next.type, next.endpoint, next.secret_name, next.enabled, next.config_json, next.updated_at, id)
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

// ---------- Models ----------

export async function listModels(env: Env) {
  const res = await env.DB.prepare(
    "SELECT m.*, p.name as provider_name, p.type as provider_type, p.secret_name as provider_secret_name, p.endpoint as provider_endpoint " +
      "FROM models m LEFT JOIN providers p ON p.id = m.provider_id ORDER BY m.created_at DESC"
  ).all<ModelWithProvider>();
  return res.results as unknown as ModelWithProvider[];
}

export async function getModel(env: Env, id: string) {
  return (await env.DB.prepare("SELECT * FROM models WHERE id = ?").bind(id).first()) as ModelWithProvider | null;
}

export async function createModel(
  env: Env,
  data: {
    provider_id: string;
    model_name: string;
    display_name?: string;
    alias?: string;
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
    enabled: data.enabled === false ? 0 : 1,
    config_json: data.config_json || null,
    created_at: t,
    updated_at: t,
  };
  await env.DB.prepare(
    "INSERT INTO models (id, provider_id, model_name, display_name, alias, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(row.id, row.provider_id, row.model_name, row.display_name, row.alias, row.enabled, row.config_json, row.created_at, row.updated_at)
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
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    config_json: data.config_json !== undefined ? data.config_json : existing.config_json,
    updated_at: now(),
  };
  await env.DB.prepare(
    "UPDATE models SET provider_id = ?, model_name = ?, display_name = ?, alias = ?, enabled = ?, config_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(next.provider_id, next.model_name, next.display_name, next.alias, next.enabled, next.config_json, next.updated_at, id)
    .run();
  return next;
}

export async function deleteModel(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM models WHERE id = ?").bind(id).run();
  return res.meta.changes > 0;
}

export async function findModelAndProvider(env: Env, modelKey: string): Promise<ModelWithProvider | null> {
  return (await env.DB.prepare(
    "SELECT m.*, p.name as provider_name, p.type as provider_type, p.secret_name as provider_secret_name, p.endpoint as provider_endpoint " +
      "FROM models m JOIN providers p ON p.id = m.provider_id " +
      "WHERE m.enabled = 1 AND p.enabled = 1 AND (m.model_name = ? OR m.alias = ?) LIMIT 1"
  ).bind(modelKey, modelKey).first()) as ModelWithProvider | null;
}

export async function listPublicModels(env: Env) {
  const res = await env.DB.prepare(
    "SELECT m.model_name as id, m.display_name, m.alias, p.name as owned_by, m.created_at " +
      "FROM models m JOIN providers p ON p.id = m.provider_id " +
      "WHERE m.enabled = 1 AND p.enabled = 1 ORDER BY p.name, m.model_name"
  ).all();
  return res.results as Array<Record<string, unknown>>;
}

// ---------- Devices ----------

export async function listDevices(env: Env) {
  const res = await env.DB.prepare(
    "SELECT id, name, enabled, last_used_at, created_at, revoked_at FROM devices ORDER BY created_at DESC"
  ).all();
  return res.results as Array<Record<string, unknown>>;
}

export async function getDeviceByHash(env: Env, tokenHash: string) {
  return (await env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?").bind(tokenHash).first<DeviceRow>()) as DeviceRow | null;
}

export async function createDevice(env: Env, name: string, tokenHash: string) {
  const id = newId("dev");
  const t = now();
  await env.DB.prepare(
    "INSERT INTO devices (id, name, token_hash, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
  ).bind(id, name, tokenHash, t).run();
  return { id, name, created_at: t };
}

export async function updateDevice(env: Env, id: string, data: { name?: string; enabled?: boolean }) {
  const existing = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!existing) return null;
  const next = {
    ...existing,
    name: data.name ?? existing.name,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
  };
  await env.DB.prepare("UPDATE devices SET name = ?, enabled = ? WHERE id = ?").bind(next.name, next.enabled, id).run();
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

// ---------- Usage ----------

export async function insertUsage(
  env: Env,
  data: {
    device_id: string | null;
    provider_id: string | null;
    provider_name: string | null;
    model: string | null;
    usage: TokenUsage | null;
    status_code: number | null;
    latency_ms: number | null;
    request_id: string;
    created_at: number;
  }
) {
  const { input_tokens, output_tokens, total_tokens } = data.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  await env.DB.prepare(
    "INSERT INTO usage (device_id, provider_id, provider_name, model, input_tokens, output_tokens, total_tokens, status_code, latency_ms, request_id, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      data.device_id,
      data.provider_id,
      data.provider_name,
      data.model,
      input_tokens,
      output_tokens,
      total_tokens,
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

// ---------- Stats ----------

export async function statsSummary(env: Env, since: number) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as request_count, " +
      "COALESCE(SUM(input_tokens), 0) as input_tokens, " +
      "COALESCE(SUM(output_tokens), 0) as output_tokens, " +
      "COALESCE(SUM(total_tokens), 0) as total_tokens, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, " +
      "COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as error_count " +
      "FROM usage WHERE created_at >= ?"
  ).bind(since).first<Record<string, number>>();
  return row;
}

export async function statsByProvider(env: Env, since: number) {
  const res = await env.DB.prepare(
    "SELECT COALESCE(provider_name, 'unknown') as name, COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as errors " +
      "FROM usage WHERE created_at >= ? GROUP BY provider_name ORDER BY requests DESC"
  ).bind(since).all();
  return res.results;
}

export async function statsByModel(env: Env, since: number) {
  const res = await env.DB.prepare(
    "SELECT COALESCE(model, 'unknown') as name, COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, " +
      "COALESCE(AVG(latency_ms), 0) as avg_latency_ms, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as errors " +
      "FROM usage WHERE created_at >= ? GROUP BY model ORDER BY requests DESC"
  ).bind(since).all();
  return res.results;
}

export async function statsTrend(env: Env, since: number) {
  const res = await env.DB.prepare(
    "SELECT strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')) as date, COUNT(*) as requests, " +
      "COALESCE(SUM(total_tokens), 0) as tokens FROM usage WHERE created_at >= ? GROUP BY date ORDER BY date ASC"
  ).bind(since).all();
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

export function randomRequestId(): string {
  return randomUUID();
}
