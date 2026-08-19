import { Hono } from "hono";
import type { Env } from "../types";
import { purgeCache, l1MemoryCache } from "../gateway/cache";

export const cacheAdminApp = new Hono<{ Bindings: Env }>();

cacheAdminApp.get("/status", async (c) => {
  return c.json({
    l1_memory_entries: l1MemoryCache.size(),
    kv_bound: Boolean(c.env.CACHE_KV),
  });
});

cacheAdminApp.post("/purge", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
  const result = await purgeCache(c.env, { model });
  return c.json({
    ok: true,
    cleared: result.cleared,
    model: model || "all",
  });
});
