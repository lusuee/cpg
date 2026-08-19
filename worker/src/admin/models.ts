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

import {
  CreateModelSchema,
  UpdateModelSchema,
  BatchCreateModelsSchema,
  BatchUpdateModelsSchema,
  BatchDeleteModelsSchema,
  zValidator,
} from "./schemas";

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

modelsApp.post("/", zValidator("json", CreateModelSchema), async (c) => {
  const data = c.req.valid("json");
  const provider = await getProvider(c.env, data.provider_id);
  if (!provider) return c.json({ error: "provider_not_found" }, 400);
  const row = await createModel(c.env, {
    provider_id: data.provider_id,
    model_name: data.model_name.trim(),
    display_name: data.display_name ? data.display_name.trim() : undefined,
    alias: data.alias ? data.alias.trim() : undefined,
    fallback_model_id: data.fallback_model_id ? data.fallback_model_id.trim() : undefined,
    input_price_per_m: data.input_price_per_m,
    output_price_per_m: data.output_price_per_m,
    cache_enabled: data.cache_enabled,
    cache_ttl: data.cache_ttl,
    enabled: data.enabled,
    config_json: data.config_json ? data.config_json.trim() : undefined,
  });
  return c.json({ item: row }, 201);
});

modelsApp.post("/batch", zValidator("json", BatchCreateModelsSchema), async (c) => {
  const data = c.req.valid("json");
  const provider = await getProvider(c.env, data.provider_id);
  if (!provider) return c.json({ error: "provider_not_found" }, 400);

  const created = [];
  for (const m of data.models) {
    const name = typeof m === "string" ? m : m.model_name;
    if (!name || typeof name !== "string") continue;
    const row = await createModel(c.env, {
      provider_id: data.provider_id,
      model_name: name.trim(),
      display_name: typeof m === "object" && m.display_name ? m.display_name.trim() : undefined,
      alias: typeof m === "object" && m.alias ? m.alias.trim() : undefined,
      enabled: true,
    });
    created.push(row);
  }
  return c.json({ created: created.length, items: created }, 201);
});

modelsApp.post("/batch-update", zValidator("json", BatchUpdateModelsSchema), async (c) => {
  const data = c.req.valid("json");
  const count = await batchUpdateModels(c.env, data.ids, { enabled: data.enabled });
  return c.json({ updated: count });
});

modelsApp.post("/batch-delete", zValidator("json", BatchDeleteModelsSchema), async (c) => {
  const data = c.req.valid("json");
  const count = await batchDeleteModels(c.env, data.ids);
  return c.json({ deleted: count });
});

modelsApp.put("/:id", zValidator("json", UpdateModelSchema), async (c) => {
  const id = c.req.param("id");
  const data = c.req.valid("json");
  if (data.provider_id) {
    const provider = await getProvider(c.env, data.provider_id);
    if (!provider) return c.json({ error: "provider_not_found" }, 400);
  }
  const row = await updateModel(c.env, id, {
    provider_id: data.provider_id,
    model_name: data.model_name !== undefined ? data.model_name.trim() : undefined,
    display_name: data.display_name !== undefined ? (data.display_name ? data.display_name.trim() : null) : undefined,
    alias: data.alias !== undefined ? (data.alias ? data.alias.trim() : null) : undefined,
    fallback_model_id: data.fallback_model_id !== undefined ? (data.fallback_model_id ? data.fallback_model_id.trim() : null) : undefined,
    input_price_per_m: data.input_price_per_m,
    output_price_per_m: data.output_price_per_m,
    cache_enabled: data.cache_enabled,
    cache_ttl: data.cache_ttl,
    enabled: data.enabled,
    config_json: data.config_json !== undefined ? (data.config_json ? data.config_json.trim() : null) : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});

modelsApp.delete("/:id", async (c) => {
  const ok = await deleteModel(c.env, c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
