import { Hono } from "hono";
import type { Env } from "../types";
import { listUsage, statsSummary, statsByProvider, statsByModel, statsTrend, aggregateDailyStats } from "../db/repo";

export const usageApp = new Hono<{ Bindings: Env }>();

const DAY_MS = 24 * 60 * 60 * 1000;
function startOfToday(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - offsetDays * DAY_MS;
}

usageApp.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(parseInt(q.limit || "50", 10) || 50, 200);
  const offset = Math.max(parseInt(q.offset || "0", 10) || 0, 0);
  const toNum = (s?: string) => (s ? parseInt(s, 10) : undefined);
  const items = await listUsage(c.env, {
    from: toNum(q.from),
    to: toNum(q.to),
    provider_id: q.provider_id || undefined,
    model: q.model || undefined,
    device_id: q.device_id || undefined,
    limit,
    offset,
  });
  return c.json({ items, limit, offset });
});

usageApp.get("/stats", async (c) => {
  const range = c.req.query("range") || "today";
  let since: number;
  if (range === "7d") since = startOfToday(6);
  else if (range === "30d") since = startOfToday(29);
  else since = startOfToday(0);

  const [summary, byProvider, byModel, trend] = await Promise.all([
    statsSummary(c.env, since),
    statsByProvider(c.env, since),
    statsByModel(c.env, since),
    statsTrend(c.env, since),
  ]);

  return c.json({
    range,
    since,
    summary,
    byProvider,
    byModel,
    trend,
  });
});

usageApp.post("/aggregate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const res = await aggregateDailyStats(c.env, body.date);
  return c.json({ ok: true, aggregated: res.aggregated });
});
