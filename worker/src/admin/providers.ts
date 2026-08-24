import { Hono } from "hono";
import type { Env, ProviderRow } from "../types";
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
  getProvider,
  createModel,
  batchUpdateProviders,
  batchDeleteProviders,
  getProviderHealthMap,
  recordProviderHealth,
  type ProviderHealthInfo,
} from "../db/repo";

import {
  CreateProviderSchema,
  UpdateProviderSchema,
  BatchUpdateProvidersSchema,
  BatchDeleteProvidersSchema,
  CcSwitchPreviewSchema,
  CcSwitchImportSchema,
  zValidator,
} from "./schemas";
import { parseCcSwitchConfig, type ParsedCcSwitchProvider } from "./ccswitch";

export const providersApp = new Hono<{ Bindings: Env }>();

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  const prefix = trimmed.slice(0, trimmed.length >= 12 ? 6 : 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function publicProvider(row: ProviderRow, env: Env, healthMap?: Record<string, ProviderHealthInfo>) {
  const hasDbKey = Boolean(row.api_key && row.api_key.trim());
  const hasEnvSecret = Boolean(row.secret_name && (env as Record<string, unknown>)[row.secret_name]);
  const health = healthMap ? healthMap[row.id] : undefined;

  return {
    ...row,
    api_key: undefined,
    api_key_configured: hasDbKey || hasEnvSecret,
    api_key_masked: hasDbKey ? maskApiKey(row.api_key) : null,
    secret_configured: hasDbKey || hasEnvSecret,
    health_status: health?.status || (row.enabled ? "healthy" : "unknown"),
    health_latency_ms: health?.latency_ms,
    last_ping_at: health?.last_ping_at,
    health_message: health?.message,
  };
}

export async function pingSingleProvider(env: Env, p: ProviderRow): Promise<{
  id: string;
  name: string;
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  latency_ms: number;
  status_code?: number;
  message?: string;
}> {
  const upstreamKey = p.api_key || (p.secret_name ? (env as Record<string, unknown>)[p.secret_name] : undefined);
  if (!upstreamKey || typeof upstreamKey !== "string") {
    const info: ProviderHealthInfo = {
      status: "unhealthy",
      latency_ms: 0,
      last_ping_at: Date.now(),
      message: "未配置 API Key",
    };
    await recordProviderHealth(env, p.id, info);
    return { id: p.id, name: p.name, ok: false, status: "unhealthy", latency_ms: 0, message: "未配置 API Key" };
  }

  const endpoint = (
    p.endpoint ||
    (p.type === "anthropic"
      ? "https://api.anthropic.com/v1"
      : p.type === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");

  let testUrl = `${endpoint}/models`;
  const headers: Record<string, string> = {
    "User-Agent": "Cloudflare-AI-Gateway/1.0",
  };

  if (p.type === "anthropic") {
    headers["x-api-key"] = upstreamKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (p.type === "gemini") {
    headers["x-goog-api-key"] = upstreamKey;
    if (endpoint.includes("/openai")) {
      headers["Authorization"] = `Bearer ${upstreamKey}`;
    } else {
      testUrl = `${endpoint}/models?key=${encodeURIComponent(upstreamKey)}`;
    }
  } else {
    headers["Authorization"] = `Bearer ${upstreamKey}`;
  }

  const t0 = Date.now();
  try {
    const res = await fetch(testUrl, {
      headers,
      signal: AbortSignal.timeout(7000),
    });
    const latency_ms = Date.now() - t0;
    const isOk = res.ok || (p.type === "anthropic" && (res.status === 404 || res.status === 400));
    const status: "healthy" | "degraded" | "unhealthy" = isOk
      ? latency_ms > 1200
        ? "degraded"
        : "healthy"
      : "unhealthy";

    const message = isOk ? "连接正常" : `上游返回 HTTP ${res.status}`;
    const info: ProviderHealthInfo = {
      status,
      latency_ms,
      last_ping_at: Date.now(),
      status_code: res.status,
      message,
    };
    await recordProviderHealth(env, p.id, info);
    return { id: p.id, name: p.name, ok: isOk, status, latency_ms, status_code: res.status, message };
  } catch (err: any) {
    const latency_ms = Date.now() - t0;
    const info: ProviderHealthInfo = {
      status: "unhealthy",
      latency_ms,
      last_ping_at: Date.now(),
      message: err.message || "请求超时或网络不可达",
    };
    await recordProviderHealth(env, p.id, info);
    return { id: p.id, name: p.name, ok: false, status: "unhealthy", latency_ms, message: info.message };
  }
}

providersApp.get("/", async (c) => {
  const [rows, healthMap] = await Promise.all([
    listProviders(c.env),
    getProviderHealthMap(c.env),
  ]);
  const result = rows.map((p) => publicProvider(p, c.env, healthMap));
  return c.json({ items: result });
});

providersApp.post("/ping-all", async (c) => {
  const rows = await listProviders(c.env);
  const enabledProviders = rows.filter((p) => p.enabled);
  const results = await Promise.all(enabledProviders.map((p) => pingSingleProvider(c.env, p)));
  return c.json({ items: results });
});

providersApp.post("/:id/ping", async (c) => {
  const id = c.req.param("id");
  const p = await getProvider(c.env, id);
  if (!p) return c.json({ error: "provider_not_found" }, 404);
  const result = await pingSingleProvider(c.env, p);
  return c.json(result);
});

providersApp.post("/", zValidator("json", CreateProviderSchema), async (c) => {
  const data = c.req.valid("json");
  const row = await createProvider(c.env, {
    name: data.name.trim(),
    type: data.type,
    endpoint: data.endpoint ? data.endpoint.trim() : undefined,
    api_key: data.api_key ? data.api_key.trim() : undefined,
    secret_name: data.secret_name ? data.secret_name.trim() : undefined,
    enabled: data.enabled !== undefined ? data.enabled : true,
    config_json: data.config_json ? data.config_json.trim() : undefined,
  });
  const { extractClientIp } = await import("../middleware/adminAuth");
  const { recordAuditLog } = await import("../db/repo");
  await recordAuditLog(c.env, {
    ip: extractClientIp(c),
    action: "provider.create",
    target_type: "provider",
    target_id: row.id,
    summary: `创建 Provider「${row.name}」(${row.type})`,
    details: { id: row.id, name: row.name, type: row.type },
  });
  return c.json({ item: publicProvider(row, c.env) }, 201);
});

providersApp.put("/:id", zValidator("json", UpdateProviderSchema), async (c) => {
  const id = c.req.param("id");
  const data = c.req.valid("json");
  const row = await updateProvider(c.env, id, {
    name: data.name !== undefined ? data.name.trim() : undefined,
    type: data.type,
    endpoint: data.endpoint !== undefined ? (data.endpoint ? data.endpoint.trim() : null) : undefined,
    api_key: data.api_key !== undefined ? (data.api_key ? data.api_key.trim() : null) : undefined,
    secret_name: data.secret_name !== undefined ? (data.secret_name ? data.secret_name.trim() : null) : undefined,
    enabled: data.enabled,
    config_json: data.config_json !== undefined ? (data.config_json ? data.config_json.trim() : null) : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);

  const { extractClientIp } = await import("../middleware/adminAuth");
  const { recordAuditLog } = await import("../db/repo");
  await recordAuditLog(c.env, {
    ip: extractClientIp(c),
    action: "provider.update",
    target_type: "provider",
    target_id: row.id,
    summary: `更新 Provider「${row.name}」`,
    details: { id: row.id, name: row.name, enabled: row.enabled },
  });

  return c.json({ item: publicProvider(row, c.env) });
});

providersApp.post("/:id/rotate-key", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { api_key?: string; secret_name?: string };
  const p = await getProvider(c.env, id);
  if (!p) return c.json({ error: "provider_not_found" }, 404);

  const newKey = body.api_key ? body.api_key.trim() : null;
  const newSecret = body.secret_name ? body.secret_name.trim() : null;

  if (!newKey && !newSecret) {
    return c.json({ error: "key_required", message: "请输入新的 API Key 或环境变量 Secret 名称" }, 400);
  }

  const row = await updateProvider(c.env, id, {
    api_key: newKey,
    secret_name: newSecret,
  });

  const { extractClientIp } = await import("../middleware/adminAuth");
  const { recordAuditLog } = await import("../db/repo");
  await recordAuditLog(c.env, {
    ip: extractClientIp(c),
    action: "provider.rotate_key",
    target_type: "provider",
    target_id: id,
    summary: `轮换 Provider「${p.name}」的 API 密钥`,
    details: { id, name: p.name, rotated_at: Date.now() },
  });

  return c.json({ ok: true, item: row ? publicProvider(row, c.env) : null });
});

providersApp.post("/batch-update", zValidator("json", BatchUpdateProvidersSchema), async (c) => {
  const data = c.req.valid("json");
  const count = await batchUpdateProviders(c.env, data.ids, { enabled: data.enabled });
  return c.json({ updated: count });
});

providersApp.post("/batch-delete", zValidator("json", BatchDeleteProvidersSchema), async (c) => {
  const data = c.req.valid("json");
  const res = await batchDeleteProviders(c.env, data.ids);
  return c.json(res);
});

providersApp.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const p = await getProvider(c.env, id);
  const ok = await deleteProvider(c.env, id);
  if (!ok) return c.json({ error: "provider_has_models", message: "请先删除该 provider 下的 models" }, 409);

  const { extractClientIp } = await import("../middleware/adminAuth");
  const { recordAuditLog } = await import("../db/repo");
  await recordAuditLog(c.env, {
    ip: extractClientIp(c),
    action: "provider.delete",
    target_type: "provider",
    target_id: id,
    summary: `删除 Provider「${p?.name || id}」`,
    details: { id, name: p?.name },
  });

  return c.json({ ok: true });
});

providersApp.post("/:id/fetch-models", async (c) => {
  const id = c.req.param("id");
  const p = await getProvider(c.env, id);
  if (!p) return c.json({ error: "provider_not_found" }, 404);

  const upstreamKey = p.api_key || (p.secret_name ? (c.env as Record<string, unknown>)[p.secret_name] : undefined);
  if (!upstreamKey || typeof upstreamKey !== "string") {
    return c.json({
      error: "provider_key_not_configured",
      message: `未配置 API 密钥，请先在 Provider 编辑窗口中输入 API Key 或配置 Secret`,
    }, 400);
  }

  const endpoint = (
    p.endpoint ||
    (p.type === "anthropic"
      ? "https://api.anthropic.com/v1"
      : p.type === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");

  let modelsUrl = `${endpoint}/models`;
  const headers: Record<string, string> = {
    "User-Agent": "Cloudflare-AI-Gateway/1.0",
  };

  if (p.type === "anthropic") {
    headers["x-api-key"] = upstreamKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (p.type === "gemini") {
    headers["x-goog-api-key"] = upstreamKey;
    if (endpoint.includes("/openai")) {
      headers["Authorization"] = `Bearer ${upstreamKey}`;
    } else {
      modelsUrl = `${endpoint}/models?key=${encodeURIComponent(upstreamKey)}`;
    }
  } else {
    headers["Authorization"] = `Bearer ${upstreamKey}`;
  }

  const fallbackAnthropicModels = [
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ];

  try {
    const res = await fetch(modelsUrl, { headers });
    if (!res.ok) {
      if (p.type === "anthropic" && (res.status === 404 || res.status === 400)) {
        return c.json({ models: fallbackAnthropicModels });
      }
      const errText = await res.text();
      return c.json({
        error: "upstream_fetch_failed",
        message: `上游返回 HTTP ${res.status}: ${errText.slice(0, 300)}`,
      }, 502);
    }
    const data: any = await res.json();
    const modelIds: string[] = [];
    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
      ? data
      : [];

    for (const item of rawList) {
      let name = typeof item === "string" ? item : item?.id || item?.name || item?.model;
      if (name && typeof name === "string") {
        if (name.startsWith("models/")) name = name.slice(7);
        modelIds.push(name);
      }
    }

    if (modelIds.length === 0 && p.type === "anthropic") {
      modelIds.push(...fallbackAnthropicModels);
    }

    return c.json({ models: Array.from(new Set(modelIds)).sort() });
  } catch (err: any) {
    if (p.type === "anthropic") {
      return c.json({ models: fallbackAnthropicModels });
    }
    return c.json({ error: "network_error", message: err.message || "请求上游超时或网络异常" }, 502);
  }
});

// CC-Switch Configuration Preview
providersApp.post("/ccswitch/preview", zValidator("json", CcSwitchPreviewSchema), async (c) => {
  const { raw } = c.req.valid("json");
  const items = parseCcSwitchConfig(raw);
  const preview = items.map((p) => ({
    ...p,
    api_key_masked: maskApiKey(p.api_key),
  }));
  return c.json({ items: preview, count: items.length });
});

// CC-Switch Configuration Import
providersApp.post("/ccswitch/import", zValidator("json", CcSwitchImportSchema), async (c) => {
  const data = c.req.valid("json");
  let itemsToImport: ParsedCcSwitchProvider[] = [];

  if (data.items && data.items.length > 0) {
    itemsToImport = data.items.map((it) => {
      let rawConfig: any = undefined;
      if (it.config_json) {
        try {
          rawConfig = JSON.parse(it.config_json);
        } catch {
          // ignore invalid json in individual item
        }
      }
      return {
        name: it.name.trim(),
        type: it.type,
        endpoint: it.endpoint ? it.endpoint.trim() : null,
        api_key: it.api_key ? it.api_key.trim() : null,
        enabled: it.enabled !== false,
        models: it.models || [],
        raw_config: rawConfig,
      };
    });
  } else if (data.raw) {
    itemsToImport = parseCcSwitchConfig(data.raw);
  }

  if (!itemsToImport.length) {
    return c.json(
      {
        error: "no_valid_providers",
        message: "未能解析到有效的 CC-Switch 配置，请检查输入格式（支持 SQL 文件、JSON 或 ccswitch:// 协议链接）",
      },
      400
    );
  }

  // Pre-fetch all existing providers to avoid N+1 queries
  const existingProvidersRes = await c.env.DB.prepare("SELECT * FROM providers").all<ProviderRow>();
  const providerByName = new Map<string, ProviderRow>();
  for (const p of existingProvidersRes.results || []) {
    providerByName.set(p.name, p);
  }

  // Pre-fetch all existing models to avoid N+1 queries
  const existingModelsRes = await c.env.DB.prepare("SELECT id, provider_id, model_name FROM models").all<{ id: string; provider_id: string; model_name: string }>();
  const modelByProvAndName = new Set<string>();
  for (const m of existingModelsRes.results || []) {
    modelByProvAndName.add(`${m.provider_id}:${m.model_name}`);
  }

  let importedProviders = 0;
  let updatedProviders = 0;
  let importedModels = 0;
  const details: Array<{
    provider_name: string;
    provider_id: string;
    status: "created" | "updated" | "skipped";
    models_created: number;
  }> = [];

  for (const item of itemsToImport) {
    const existing = providerByName.get(item.name);

    let targetProviderId = "";
    let status: "created" | "updated" | "skipped" = "created";

    if (existing) {
      if (data.overwrite) {
        await updateProvider(c.env, existing.id, {
          type: item.type,
          endpoint: item.endpoint,
          api_key: item.api_key || existing.api_key,
          enabled: item.enabled,
          config_json: item.raw_config ? JSON.stringify(item.raw_config) : undefined,
        });
        targetProviderId = existing.id;
        status = "updated";
        updatedProviders++;
      } else {
        const newName = `${item.name} (导入)`;
        const newRow = await createProvider(c.env, {
          name: newName,
          type: item.type,
          endpoint: item.endpoint,
          api_key: item.api_key,
          enabled: item.enabled,
          config_json: item.raw_config ? JSON.stringify(item.raw_config) : undefined,
        });
        targetProviderId = newRow.id;
        providerByName.set(newName, newRow);
        status = "created";
        importedProviders++;
      }
    } else {
      const newRow = await createProvider(c.env, {
        name: item.name,
        type: item.type,
        endpoint: item.endpoint,
        api_key: item.api_key,
        enabled: item.enabled,
        config_json: item.raw_config ? JSON.stringify(item.raw_config) : undefined,
      });
      targetProviderId = newRow.id;
      providerByName.set(item.name, newRow);
      status = "created";
      importedProviders++;
    }

    let modelsCreatedForProv = 0;
    if (data.import_models !== false && item.models && item.models.length > 0) {
      for (const m of item.models) {
        if (!m.model_name) continue;
        const key = `${targetProviderId}:${m.model_name.trim()}`;
        if (!modelByProvAndName.has(key)) {
          await createModel(c.env, {
            provider_id: targetProviderId,
            model_name: m.model_name.trim(),
            display_name: m.display_name?.trim() || undefined,
            alias: m.alias?.trim() || undefined,
            input_price_per_m: m.input_price_per_m || 0,
            output_price_per_m: m.output_price_per_m || 0,
            enabled: true,
          });
          modelByProvAndName.add(key);
          modelsCreatedForProv++;
          importedModels++;
        }
      }
    }

    details.push({
      provider_name: item.name,
      provider_id: targetProviderId,
      status,
      models_created: modelsCreatedForProv,
    });
  }

  return c.json({
    success: true,
    imported_providers: importedProviders,
    updated_providers: updatedProviders,
    imported_models: importedModels,
    details,
  });
});

