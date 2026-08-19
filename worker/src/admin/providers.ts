import { Hono } from "hono";
import type { Env, ProviderRow } from "../types";
import { createProvider, deleteProvider, listProviders, updateProvider, getProvider } from "../db/repo";

export const providersApp = new Hono<{ Bindings: Env }>();

providersApp.get("/", async (c) => {
  const rows = await listProviders(c.env);
  const result = rows.map((p) => ({
    ...p,
    secret_configured: Boolean(p.secret_name && (c.env as Record<string, unknown>)[p.secret_name]),
  }));
  return c.json({ items: result });
});

providersApp.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
  if (body.type !== "anthropic" && body.type !== "openai") {
    return c.json({ error: "type must be anthropic or openai" }, 400);
  }
  const row = await createProvider(c.env, {
    name: body.name,
    type: body.type,
    endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
    secret_name: typeof body.secret_name === "string" ? body.secret_name : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    config_json: typeof body.config_json === "string" ? body.config_json : undefined,
  });
  return c.json({ item: publicProvider(row, c.env) }, 201);
});

providersApp.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (body.type && body.type !== "anthropic" && body.type !== "openai") {
    return c.json({ error: "type must be anthropic or openai" }, 400);
  }
  const row = await updateProvider(c.env, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    type: body.type,
    endpoint: "endpoint" in body ? (body.endpoint ?? null) : undefined,
    secret_name: "secret_name" in body ? (body.secret_name ?? null) : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    config_json: "config_json" in body ? (body.config_json ?? null) : undefined,
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

  const secretName = p.secret_name;
  const upstreamKey = secretName ? (c.env as Record<string, unknown>)[secretName] : undefined;
  if (!upstreamKey || typeof upstreamKey !== "string") {
    return c.json({
      error: "provider_secret_not_configured",
      message: `未找到 Secret 密钥「${secretName || "未指定"}」，请先在 Cloudflare 环境变量中添加`,
    }, 400);
  }

  const endpoint = (p.endpoint || (p.type === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const modelsUrl = `${endpoint}/models`;

  const headers: Record<string, string> = {
    "User-Agent": "Cloudflare-AI-Gateway/1.0",
  };
  if (p.type === "anthropic") {
    headers["x-api-key"] = upstreamKey;
    headers["anthropic-version"] = "2023-06-01";
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
      const name = typeof item === "string" ? item : item?.id || item?.name;
      if (name && typeof name === "string") modelIds.push(name);
    }
    return c.json({ models: modelIds.sort() });
  } catch (err: any) {
    return c.json({ error: "network_error", message: err.message || "请求上游超时或网络异常" }, 502);
  }
});

function publicProvider(row: ProviderRow, env: Env) {
  return {
    ...row,
    secret_configured: Boolean(row.secret_name && (env as Record<string, unknown>)[row.secret_name]),
  };
}
