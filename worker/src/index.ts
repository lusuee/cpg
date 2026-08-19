import { Hono } from "hono";
import type { Env } from "./types";
import { adminApp } from "./admin";
import { gatewayApp } from "./gateway";
import { ensureSchema } from "./db/schema";
import { aggregateDailyStats } from "./db/repo";

export const app = new Hono<{ Bindings: Env }>();

// Browser HTML navigation & SPA page refresh protection:
// If a browser sends GET for HTML on any non-API route (e.g. /models, /providers, /settings), serve SPA frontend assets
app.use("*", async (c, next) => {
  if (
    c.req.method === "GET" &&
    !c.req.path.startsWith("/api/") &&
    !c.req.path.startsWith("/v1/") &&
    c.req.header("accept")?.includes("text/html") &&
    c.env.ASSETS
  ) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return next();
});

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
app.route("/", gatewayApp);

// Serve the built web dashboard (SPA fallback handled by [assets] config).
app.all("*", async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: "not_found" }, 404);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error("Worker unhandled error:", err);
  return c.json({ error: err.message || "internal_server_error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(aggregateDailyStats(env));
  },
};

