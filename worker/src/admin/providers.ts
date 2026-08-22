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

export function publicProvider(row: ProviderRow, env: Env) {
  const hasDbKey = Boolean(row.api_key && row.api_key.trim());
  const hasEnvSecret = Boolean(row.secret_name && (env as Record<string, unknown>)[row.secret_name]);
  return {
    ...row,
    api_key: undefined,
    api_key_configured: hasDbKey || hasEnvSecret,
    api_key_masked: hasDbKey ? maskApiKey(row.api_key) : null,
    secret_configured: hasDbKey || hasEnvSecret,
  };
}

providersApp.get("/", async (c) => {
  const rows = await listProviders(c.env);
  const result = rows.map((p) => publicProvider(p, c.env));
  return c.json({ items: result });
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
  return c.json({ item: publicProvider(row, c.env) });
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
  const ok = await deleteProvider(c.env, c.req.param("id"));
  if (!ok) return c.json({ error: "provider_has_models", message: "请先删除该 provider 下的 models" }, 409);
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
    modelsUrl = `${endpoint}/models?key=${encodeURIComponent(upstreamKey)}`;
  } else {
    headers["Authorization"] = `Bearer ${upstreamKey}`;
  }

  try {
    const res = await fetch(modelsUrl, { headers });
    if (!res.ok) {
      const errText = await res.text();
      return c.json({
        error: "upstream_fetch_failed",
        message: `上游返回 HTTP ${res.status}: ${errText.slice(0, 300)}`,
      }, 502);
    }
    const data: any = await res.json();
    const modelIds: string[] = [];
    const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    for (const item of rawList) {
      let name = typeof item === "string" ? item : item?.id || item?.name;
      if (name && typeof name === "string") {
        if (name.startsWith("models/")) name = name.slice(7);
        modelIds.push(name);
      }
    }
    return c.json({ models: Array.from(new Set(modelIds)).sort() });
  } catch (err: any) {
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
    itemsToImport = data.items.map((it) => ({
      name: it.name.trim(),
      type: it.type,
      endpoint: it.endpoint ? it.endpoint.trim() : null,
      api_key: it.api_key ? it.api_key.trim() : null,
      enabled: it.enabled !== false,
      models: it.models || [],
      raw_config: it.config_json ? JSON.parse(it.config_json) : undefined,
    }));
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
    // Check if provider exists by name
    const existing = (await c.env.DB.prepare("SELECT * FROM providers WHERE name = ?")
      .bind(item.name)
      .first()) as ProviderRow | null;

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
        // Create as new provider with modified name if duplicate
        const newRow = await createProvider(c.env, {
          name: `${item.name} (导入)`,
          type: item.type,
          endpoint: item.endpoint,
          api_key: item.api_key,
          enabled: item.enabled,
          config_json: item.raw_config ? JSON.stringify(item.raw_config) : undefined,
        });
        targetProviderId = newRow.id;
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
      status = "created";
      importedProviders++;
    }

    let modelsCreatedForProv = 0;
    if (data.import_models !== false && item.models && item.models.length > 0) {
      for (const m of item.models) {
        if (!m.model_name) continue;
        // Check if model already exists under this provider
        const existingModel = await c.env.DB.prepare(
          "SELECT id FROM models WHERE provider_id = ? AND model_name = ?"
        )
          .bind(targetProviderId, m.model_name)
          .first();

        if (!existingModel) {
          await createModel(c.env, {
            provider_id: targetProviderId,
            model_name: m.model_name.trim(),
            display_name: m.display_name?.trim() || undefined,
            alias: m.alias?.trim() || undefined,
            input_price_per_m: m.input_price_per_m || 0,
            output_price_per_m: m.output_price_per_m || 0,
            enabled: true,
          });
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

