import { Hono } from "hono";
import type { Env } from "../types";
import { listProviders } from "../db/repo";

export const settingsApp = new Hono<{ Bindings: Env }>();

settingsApp.get("/", async (c) => {
  const providers = await listProviders(c.env);
  return c.json({
    app_name: c.env.APP_NAME || "Personal AI Gateway",
    gateway_base_url: c.env.GATEWAY_BASE_URL || "",
    provider_count: providers.length,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      enabled: Boolean(p.enabled),
      secret_configured: Boolean(p.secret_name && (c.env as Record<string, unknown>)[p.secret_name]),
    })),
  });
});
