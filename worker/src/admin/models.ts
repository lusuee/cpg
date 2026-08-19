import { Hono } from "hono";
import type { Env } from "../types";
import {
  createModel,
  deleteModel,
  listModels,
  updateModel,
  getProvider,
  batchUpdateModels,
  batchDeleteModels,
} from "../db/repo";
import { buildModelCatalog } from "../gateway/catalog";

export const modelsApp = new Hono<{ Bindings: Env }>();

modelsApp.get("/", async (c) => {
  const items = await listModels(c.env);
  return c.json({ items });
});

modelsApp.get("/catalog", async (c) => {
  const items = await listModels(c.env);
  const catalog = buildModelCatalog(items);
  return c.json(catalog);
});

modelsApp.get("/catalog/export", async (c) => {
  const items = await listModels(c.env);
  const catalog = buildModelCatalog(items);
  const json = JSON.stringify(catalog, null, 2);
  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="model-catalog.json"',
    },
  });
});

modelsApp.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.model_name || typeof body.model_name !== "string") return c.json({ error: "model_name is required" }, 400);
  if (!body.provider_id || typeof body.provider_id !== "string") return c.json({ error: "provider_id is required" }, 400);
  const provider = await getProvider(c.env, body.provider_id);
  if (!provider) return c.json({ error: "provider_not_found" }, 400);
  const row = await createModel(c.env, {
    provider_id: body.provider_id,
    model_name: body.model_name,
    display_name: typeof body.display_name === "string" ? body.display_name : undefined,
    alias: typeof body.alias === "string" ? body.alias : undefined,
    fallback_model_id: typeof body.fallback_model_id === "string" ? body.fallback_model_id : undefined,
    input_price_per_m: typeof body.input_price_per_m === "number" ? body.input_price_per_m : undefined,
    output_price_per_m: typeof body.output_price_per_m === "number" ? body.output_price_per_m : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    config_json: typeof body.config_json === "string" ? body.config_json : undefined,
  });
  return c.json({ item: row }, 201);
});

modelsApp.post("/batch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const providerId = body.provider_id;
  const models = body.models;
  if (!providerId || typeof providerId !== "string") return c.json({ error: "provider_id is required" }, 400);
  if (!Array.isArray(models) || !models.length) return c.json({ error: "models array is required" }, 400);

  const provider = await getProvider(c.env, providerId);
  if (!provider) return c.json({ error: "provider_not_found" }, 400);

  const created = [];
  for (const m of models) {
    const name = typeof m === "string" ? m : m.model_name;
    if (!name || typeof name !== "string") continue;
    const row = await createModel(c.env, {
      provider_id: providerId,
      model_name: name,
      display_name: typeof m === "object" && m.display_name ? m.display_name : undefined,
      alias: typeof m === "object" && m.alias ? m.alias : undefined,
      enabled: true,
    });
    created.push(row);
  }
  return c.json({ created: created.length, items: created }, 201);
});

modelsApp.post("/batch-update", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "ids array is required" }, 400);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const count = await batchUpdateModels(c.env, ids, { enabled });
  return c.json({ updated: count });
});

modelsApp.post("/batch-delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.length) return c.json({ error: "ids array is required" }, 400);
  const count = await batchDeleteModels(c.env, ids);
  return c.json({ deleted: count });
});

modelsApp.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (body.provider_id && typeof body.provider_id === "string") {
    const provider = await getProvider(c.env, body.provider_id);
    if (!provider) return c.json({ error: "provider_not_found" }, 400);
  }
  const row = await updateModel(c.env, id, {
    provider_id: typeof body.provider_id === "string" ? body.provider_id : undefined,
    model_name: typeof body.model_name === "string" ? body.model_name.trim() : undefined,
    display_name: "display_name" in body ? (body.display_name ? String(body.display_name).trim() : null) : undefined,
    alias: "alias" in body ? (body.alias ? String(body.alias).trim() : null) : undefined,
    fallback_model_id: "fallback_model_id" in body ? (body.fallback_model_id ? String(body.fallback_model_id).trim() : null) : undefined,
    input_price_per_m: typeof body.input_price_per_m === "number" ? body.input_price_per_m : undefined,
    output_price_per_m: typeof body.output_price_per_m === "number" ? body.output_price_per_m : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    config_json: "config_json" in body ? (body.config_json ? String(body.config_json).trim() : null) : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});

modelsApp.delete("/:id", async (c) => {
  const ok = await deleteModel(c.env, c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
