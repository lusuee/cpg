import { Hono } from "hono";
import type { Env, ProviderRow } from "../types";
import { createProvider, deleteProvider, listProviders, updateProvider, getProvider } from "../db/repo";

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

providersApp.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
  if (body.type !== "anthropic" && body.type !== "openai" && body.type !== "gemini") {
    return c.json({ error: "type must be anthropic, openai or gemini" }, 400);
  }
  const row = await createProvider(c.env, {
    name: body.name.trim(),
    type: body.type,
    endpoint: typeof body.endpoint === "string" ? body.endpoint.trim() : undefined,
    api_key: typeof body.api_key === "string" ? body.api_key.trim() : undefined,
    secret_name: typeof body.secret_name === "string" ? body.secret_name.trim() : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    config_json: typeof body.config_json === "string" ? body.config_json : undefined,
  });
  return c.json({ item: publicProvider(row, c.env) }, 201);
});

providersApp.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (body.type && body.type !== "anthropic" && body.type !== "openai" && body.type !== "gemini") {
    return c.json({ error: "type must be anthropic, openai or gemini" }, 400);
  }
  const row = await updateProvider(c.env, id, {
    name: typeof body.name === "string" ? body.name.trim() : undefined,
    type: body.type,
    endpoint: "endpoint" in body ? (body.endpoint ? String(body.endpoint).trim() : null) : undefined,
    api_key: "api_key" in body ? (body.api_key ? String(body.api_key).trim() : null) : undefined,
    secret_name: "secret_name" in body ? (body.secret_name ? String(body.secret_name).trim() : null) : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    config_json: "config_json" in body ? (body.config_json ? String(body.config_json).trim() : null) : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: publicProvider(row, c.env) });
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
