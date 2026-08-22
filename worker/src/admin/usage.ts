import { Hono } from "hono";
import type { Env, MonthlyReport, UsageRow } from "../types";
import {
  listUsage,
  statsSummary,
  statsByProvider,
  statsByModel,
  statsTrend,
  aggregateDailyStats,
  getLatestUsage,
  statsCacheAnalytics,
  statsModelLatency,
  generateMonthlyReport,
  statsCostAnalytics,
} from "../db/repo";
import { sendWebhookNotification } from "../utils/webhook";

export const usageApp = new Hono<{ Bindings: Env }>();

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTzOffsetMinutes(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): number {
  const header = c.req.header("x-timezone-offset");
  if (header !== undefined && header !== "") {
    const n = parseInt(header, 10);
    if (!isNaN(n) && n >= -840 && n <= 840) return n;
  }
  const q = c.req.query("tzOffset");
  if (q !== undefined && q !== "") {
    const n = parseInt(q, 10);
    if (!isNaN(n) && n >= -840 && n <= 840) return n;
  }
  // Default to -480 (UTC+8 / China Standard Time)
  return -480;
}

export function startOfToday(offsetDays = 0, tzOffsetMinutes = -480): number {
  const now = Date.now();
  const localTime = now - tzOffsetMinutes * 60 * 1000;
  const localMidnight = Math.floor(localTime / DAY_MS) * DAY_MS;
  const utcMidnight = localMidnight + tzOffsetMinutes * 60 * 1000;
  return utcMidnight - offsetDays * DAY_MS;
}

export function formatSqlTimezoneModifier(tzOffsetMinutes: number): string {
  const shiftMinutes = -tzOffsetMinutes;
  const sign = shiftMinutes >= 0 ? "+" : "-";
  return `${sign}${Math.abs(shiftMinutes)} minutes`;
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

  return "\uFEFF" + lines.join("\r\n");
}

export function formatMonthlyReportCsv(report: MonthlyReport): string {
  const lines: string[] = [];
  lines.push(`CPG AI 网关月度账单报表 - ${report.month}`);
  lines.push("");
  lines.push("=== 核心概览 ===");
  lines.push(`统计月份,${report.month}`);
  lines.push(`总消耗金额 (USD),$${report.total_cost_usd.toFixed(4)}`);
  lines.push(`总请求次数,${report.total_requests}`);
  lines.push(`输入 Token,${report.total_input_tokens}`);
  lines.push(`输出 Token,${report.total_output_tokens}`);
  lines.push(`总 Token,${report.total_tokens}`);
  lines.push(`缓存命中次数,${report.cache_hit_count}`);
  lines.push(`缓存节省金额 (USD),$${report.cache_saved_cost_usd.toFixed(4)}`);
  lines.push(`环比上月费用涨跌,${report.mom_growth.cost_growth_percent}%`);
  lines.push(`环比上月请求涨跌,${report.mom_growth.request_growth_percent}%`);
  lines.push("");

  lines.push("=== 模型消费构成 ===");
  lines.push("模型名称,请求次数,输入 Token,输出 Token,总 Token,消费金额 (USD),占比 (%)");
  for (const m of report.by_model) {
    lines.push(
      [
        escapeCsvField(m.name),
        m.request_count,
        m.input_tokens,
        m.output_tokens,
        m.total_tokens,
        m.cost_usd.toFixed(4),
        `${m.share_percent}%`,
      ].join(",")
    );
  }
  lines.push("");

  lines.push("=== 服务商消费构成 ===");
  lines.push("服务商,请求次数,输入 Token,输出 Token,总 Token,消费金额 (USD),占比 (%)");
  for (const p of report.by_provider) {
    lines.push(
      [
        escapeCsvField(p.name),
        p.request_count,
        p.input_tokens,
        p.output_tokens,
        p.total_tokens,
        p.cost_usd.toFixed(4),
        `${p.share_percent}%`,
      ].join(",")
    );
  }
  lines.push("");

  lines.push("=== 设备/客户端消费构成 ===");
  lines.push("设备名称,请求次数,输入 Token,输出 Token,总 Token,消费金额 (USD),占比 (%)");
  for (const d of report.by_device) {
    lines.push(
      [
        escapeCsvField(d.name),
        d.request_count,
        d.input_tokens,
        d.output_tokens,
        d.total_tokens,
        d.cost_usd.toFixed(4),
        `${d.share_percent}%`,
      ].join(",")
    );
  }
  lines.push("");

  lines.push("=== 每日消费走势 ===");
  lines.push("日期,请求次数,总 Token,消费金额 (USD)");
  for (const t of report.daily_trend) {
    lines.push([t.date, t.request_count, t.total_tokens, t.cost_usd.toFixed(4)].join(","));
  }

  return "\uFEFF" + lines.join("\r\n");
}

usageApp.get("/latest", async (c) => {
  const afterId = c.req.query("after_id") ? parseInt(c.req.query("after_id")!, 10) : undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 20;
  const items = await getLatestUsage(c.env, afterId, limit);
  return c.json({ items, count: items.length });
});

usageApp.get("/cache-stats", async (c) => {
  const range = c.req.query("range") || "today";
  const tzOffset = getTzOffsetMinutes(c);
  let since: number;
  if (range === "7d") since = startOfToday(6, tzOffset);
  else if (range === "30d") since = startOfToday(29, tzOffset);
  else since = startOfToday(0, tzOffset);

  const analytics = await statsCacheAnalytics(c.env, since);
  return c.json(analytics);
});

usageApp.get("/model-latency", async (c) => {
  const range = c.req.query("range") || "today";
  const tzOffset = getTzOffsetMinutes(c);
  let since: number;
  if (range === "7d") since = startOfToday(6, tzOffset);
  else if (range === "30d") since = startOfToday(29, tzOffset);
  else since = startOfToday(0, tzOffset);

  const benchmark = await statsModelLatency(c.env, since);
  return c.json({ items: benchmark });
});

usageApp.get("/monthly-report", async (c) => {
  const month = c.req.query("month");
  const tzOffset = getTzOffsetMinutes(c);
  const tzModifier = formatSqlTimezoneModifier(tzOffset);
  const report = await generateMonthlyReport(c.env, month, tzModifier);
  return c.json(report);
});

usageApp.get("/monthly-report/export", async (c) => {
  const month = c.req.query("month");
  const tzOffset = getTzOffsetMinutes(c);
  const tzModifier = formatSqlTimezoneModifier(tzOffset);
  const report = await generateMonthlyReport(c.env, month, tzModifier);
  const csv = formatMonthlyReportCsv(report);
  const filename = `monthly-bill-${report.month}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
});

usageApp.post("/monthly-report/push-webhook", async (c) => {
  const month = c.req.query("month");
  const tzOffset = getTzOffsetMinutes(c);
  const tzModifier = formatSqlTimezoneModifier(tzOffset);
  const report = await generateMonthlyReport(c.env, month, tzModifier);

  const topModels = report.by_model.slice(0, 3).map((m) => `• **${m.name}**: $${m.cost_usd.toFixed(2)} (${m.share_percent}%)`).join("\n");
  const topProviders = report.by_provider.slice(0, 3).map((p) => `• **${p.name}**: $${p.cost_usd.toFixed(2)} (${p.share_percent}%)`).join("\n");

  const msg = [
    `### 📊【AI Gateway】${report.month} 月度用量账单汇总`,
    `> **当月总消耗**: **$${report.total_cost_usd.toFixed(2)}** (环比上月: ${report.mom_growth.cost_growth_percent >= 0 ? "+" : ""}${report.mom_growth.cost_growth_percent}%)`,
    `> **总请求数**: **${report.total_requests.toLocaleString()}** 次 | **总 Token**: **${report.total_tokens.toLocaleString()}**`,
    report.cache_saved_cost_usd > 0 ? `> **KV 缓存节省**: 命中 **${report.cache_hit_count}** 次，节省 **$${report.cache_saved_cost_usd.toFixed(2)}**` : "",
    "",
    "**🏆 模型消费 Top 3**:",
    topModels || "• 无消耗记录",
    "",
    "**🏢 服务商消费 Top 3**:",
    topProviders || "• 无消耗记录",
  ].filter(Boolean).join("\n");

  const result = await sendWebhookNotification(c.env, {
    event: "monthly_report",
    title: `📊【AI Gateway】${report.month} 月度账单摘要`,
    message: msg,
    details: {
      month: report.month,
      total_cost_usd: report.total_cost_usd,
      total_requests: report.total_requests,
      total_tokens: report.total_tokens,
      mom_growth_cost_pct: report.mom_growth.cost_growth_percent,
    },
  });

  return c.json({ ok: result.ok, message: result.ok ? "月度账单已成功推送到 Webhook" : (result.error || "Webhook 推送失败或未配置"), details: result });
});

usageApp.get("/cost-analytics", async (c) => {
  const range = c.req.query("range") || "30d";
  const tzOffset = getTzOffsetMinutes(c);
  let since: number;
  if (range === "7d") since = startOfToday(6, tzOffset);
  else if (range === "90d") since = startOfToday(89, tzOffset);
  else since = startOfToday(29, tzOffset);

  const tzModifier = formatSqlTimezoneModifier(tzOffset);
  const analytics = await statsCostAnalytics(c.env, since, tzModifier);
  return c.json(analytics);
});

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
  const tzOffset = getTzOffsetMinutes(c);
  let since: number;
  if (range === "7d") since = startOfToday(6, tzOffset);
  else if (range === "30d") since = startOfToday(29, tzOffset);
  else since = startOfToday(0, tzOffset);

  const tzModifier = formatSqlTimezoneModifier(tzOffset);

  const [summary, byProvider, byModel, trend] = await Promise.all([
    statsSummary(c.env, since),
    statsByProvider(c.env, since),
    statsByModel(c.env, since),
    statsTrend(c.env, since, tzModifier),
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
  const tzOffset = getTzOffsetMinutes(c);
  const tzModifier = formatSqlTimezoneModifier(tzOffset);
  const body = (await c.req.json().catch(() => ({}))) as { targetDate?: string };
  const res = await aggregateDailyStats(c.env, body?.targetDate, tzModifier);
  return c.json({ ok: true, aggregated: res.aggregated });
});
