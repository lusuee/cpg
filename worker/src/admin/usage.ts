import { Hono } from "hono";
import type { Env, UsageRow } from "../types";
import { listUsage, statsSummary, statsByProvider, statsByModel, statsTrend, aggregateDailyStats } from "../db/repo";

export const usageApp = new Hono<{ Bindings: Env }>();

const DAY_MS = 24 * 60 * 60 * 1000;
function startOfToday(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - offsetDays * DAY_MS;
}

export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatUsageCsv(items: UsageRow[]): string {
  const headers = [
    "ID",
    "Time (UTC)",
    "Provider",
    "Model",
    "Device ID",
    "Input Tokens",
    "Output Tokens",
    "Total Tokens",
    "Cost (USD)",
    "Latency (ms)",
    "Status Code",
    "Cache Hit",
    "Request ID",
  ];

  const lines = [headers.join(",")];
  for (const item of items) {
    const timeIso = item.created_at ? new Date(item.created_at).toISOString() : "";
    const row = [
      item.id,
      escapeCsvField(timeIso),
      escapeCsvField(item.provider_name || item.provider_id || ""),
      escapeCsvField(item.model || ""),
      escapeCsvField(item.device_id || ""),
      item.input_tokens ?? 0,
      item.output_tokens ?? 0,
      item.total_tokens ?? 0,
      (item.cost_usd || 0).toFixed(6),
      item.latency_ms ?? "",
      item.status_code ?? "",
      item.cache_hit ? "YES" : "NO",
      escapeCsvField(item.request_id || ""),
    ];
    lines.push(row.join(","));
  }

  // Prepend UTF-8 BOM (\uFEFF) for seamless Excel Chinese/Unicode opening
  return "\uFEFF" + lines.join("\r\n");
}

usageApp.get("/export", async (c) => {
  const q = c.req.query();
  const limit = Math.min(parseInt(q.limit || "5000", 10) || 5000, 20000);
  const toNum = (s?: string) => (s ? parseInt(s, 10) : undefined);

  const items = await listUsage(c.env, {
    from: toNum(q.from),
    to: toNum(q.to),
    provider_id: q.provider_id || undefined,
    model: q.model || undefined,
    device_id: q.device_id || undefined,
    limit,
    offset: 0,
  });

  const csv = formatUsageCsv(items);
  const nowStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `usage-export-${nowStr}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
});

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

import { AggregateStatsSchema, zValidator } from "./schemas";

usageApp.post("/aggregate", zValidator("json", AggregateStatsSchema), async (c) => {
  const data = c.req.valid("json");
  const res = await aggregateDailyStats(c.env, data.date);
  return c.json({ ok: true, aggregated: res.aggregated });
});
