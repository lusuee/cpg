import { Hono } from "hono";
import type { Env } from "./types";
import { adminApp } from "./admin";
import { gatewayApp } from "./gateway";
import { ensureSchema } from "./db/schema";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env);
  return next();
});

app.use("/v1/*", async (c, next) => {
  await ensureSchema(c.env);
  return next();
});

app.get("/health", (c) => c.json({ ok: true, service: "personal-ai-gateway" }));

app.route("/api", adminApp);
app.route("/v1", gatewayApp);

// Unknown API routes should return JSON, not the SPA HTML fallback.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("/v1/*", (c) => c.json({ error: "not_found" }, 404));

// Serve the built web dashboard (SPA fallback handled by [assets] config).
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
  fetch: app.fetch,
};
