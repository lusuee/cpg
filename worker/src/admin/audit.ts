import { Hono } from "hono";
import type { Env } from "../types";
import { listAuditLogs } from "../db/repo";
import { extractClientIp } from "../middleware/adminAuth";

export const auditApp = new Hono<{ Bindings: Env }>();

auditApp.get("/", async (c) => {
  const limit = Number(c.req.query("limit")) || 50;
  const offset = Number(c.req.query("offset")) || 0;
  const action = c.req.query("action") || undefined;
  const targetType = c.req.query("target_type") || undefined;

  const res = await listAuditLogs(c.env, {
    limit,
    offset,
    action,
    target_type: targetType,
  });

  return c.json(res);
});

auditApp.get("/export", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 500, 1000);
  const action = c.req.query("action") || undefined;
  const targetType = c.req.query("target_type") || undefined;

  const res = await listAuditLogs(c.env, {
    limit,
    offset: 0,
    action,
    target_type: targetType,
  });

  const header = "\uFEFF操作时间,操作人类型,客户端 IP,动作,对象类型,对象 ID,摘要描述,变更详情\n";
  const rows = res.items.map((item) => {
    const timeStr = new Date(item.created_at).toISOString().replace("T", " ").slice(0, 19);
    const escapeCsv = (str: string | null | undefined) => `"${(str || "").replace(/"/g, '""')}"`;
    return [
      escapeCsv(timeStr),
      escapeCsv(item.actor_type),
      escapeCsv(item.ip || "-"),
      escapeCsv(item.action),
      escapeCsv(item.target_type),
      escapeCsv(item.target_id || "-"),
      escapeCsv(item.summary),
      escapeCsv(item.details_json || "-"),
    ].join(",");
  });

  const csv = header + rows.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-logs-${Date.now()}.csv"`,
    },
  });
});
