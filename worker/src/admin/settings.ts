import { Hono } from "hono";
import type { Env } from "../types";
import { listProviders, getSetting, setSetting, getCurrentMonthSpend } from "../db/repo";
import { sendWebhookNotification, type WebhookConfig } from "../utils/webhook";

export const settingsApp = new Hono<{ Bindings: Env }>();

settingsApp.get("/", async (c) => {
  const providers = await listProviders(c.env);
  const reqOrigin = new URL(c.req.url).origin;
  const rawBaseUrl = c.env.GATEWAY_BASE_URL;
  const gateway_base_url =
    rawBaseUrl && rawBaseUrl !== "https://ai.example.com"
      ? rawBaseUrl
      : reqOrigin;

  return c.json({
    app_name: c.env.APP_NAME || "Personal AI Gateway",
    gateway_base_url,
    provider_count: providers.length,
    cf_access_configured: Boolean(c.env.CF_ACCESS_ALLOWED_EMAILS),
    kv_cache_configured: Boolean(c.env.CACHE_KV),
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      enabled: Boolean(p.enabled),
      api_key_configured: Boolean(p.api_key || (p.secret_name && (c.env as Record<string, unknown>)[p.secret_name])),
      secret_configured: Boolean(p.api_key || (p.secret_name && (c.env as Record<string, unknown>)[p.secret_name])),
    })),
  });
});

// ---------- Budget & Quota Controls ----------

export interface BudgetConfig {
  monthly_budget_usd: number;
  budget_action: "warn" | "block";
  alert_threshold_pct: number;
}

settingsApp.get("/budget", async (c) => {
  const cfg = (await getSetting<BudgetConfig>(c.env, "budget_config")) || {
    monthly_budget_usd: 0,
    budget_action: "warn",
    alert_threshold_pct: 80,
  };
  const spent = await getCurrentMonthSpend(c.env);
  return c.json({
    ...cfg,
    spent_this_month_usd: spent,
  });
});

settingsApp.put("/budget", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<BudgetConfig>;
  const monthly_budget_usd = typeof body.monthly_budget_usd === "number" ? Math.max(0, body.monthly_budget_usd) : 0;
  const budget_action = body.budget_action === "block" ? "block" : "warn";
  const alert_threshold_pct = typeof body.alert_threshold_pct === "number" ? Math.min(100, Math.max(1, body.alert_threshold_pct)) : 80;

  const cfg: BudgetConfig = {
    monthly_budget_usd,
    budget_action,
    alert_threshold_pct,
  };
  await setSetting(c.env, "budget_config", cfg);
  return c.json({ ok: true, config: cfg });
});

// ---------- Webhook Notifications ----------

settingsApp.get("/webhook", async (c) => {
  const cfg = await getSetting<WebhookConfig>(c.env, "webhook_config");
  return c.json({
    url: cfg?.url || "",
    events: Array.isArray(cfg?.events) ? cfg.events : ["budget_exceeded", "provider_error"],
    secret_configured: Boolean(cfg?.secret),
  });
});

settingsApp.put("/webhook", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<WebhookConfig>;
  const existing = (await getSetting<WebhookConfig>(c.env, "webhook_config")) || { url: "", events: [] };

  const url = (body.url || "").trim();
  const events = Array.isArray(body.events) ? body.events : ["budget_exceeded", "provider_error"];
  const secret = body.secret !== undefined && body.secret.trim() !== "" ? body.secret.trim() : existing.secret;

  const config: WebhookConfig = {
    url,
    events,
    secret: secret || undefined,
  };
  await setSetting(c.env, "webhook_config", config);
  return c.json({ ok: true, secret_configured: Boolean(config.secret) });
});

settingsApp.post("/test-webhook", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string; secret?: string };
  // If temporary URL passed in body, test it; otherwise use saved config
  if (body?.url) {
    const { buildPlatformPayload } = await import("../utils/webhook");
    const payload = {
      event: "test" as const,
      title: "【AI Gateway】Webhook 连通性测试",
      message: "恭喜！您的 Webhook 告警通道已成功打通，后续可正常接收异常报警与用量提醒。",
      details: {
        gateway_app: c.env.APP_NAME || "Personal AI Gateway",
        test_status: "SUCCESS",
      },
      timestamp: Date.now(),
    };
    const { body: reqBody, headers } = buildPlatformPayload(body.url, payload);
    if (body.secret) headers["X-Webhook-Secret"] = body.secret;

    try {
      const res = await fetch(body.url, { method: "POST", headers, body: reqBody });
      if (!res.ok) {
        const txt = await res.text();
        return c.json({ ok: false, error: `上游返回 HTTP ${res.status}: ${txt.slice(0, 150)}` }, 400);
      }
      return c.json({ ok: true, status: res.status });
    } catch (err: any) {
      return c.json({ ok: false, error: err.message || "请求目标 Webhook 超时或网络不可达" }, 400);
    }
  }

  const result = await sendWebhookNotification(c.env, {
    event: "test",
    title: "【AI Gateway】Webhook 连通性测试",
    message: "恭喜！您的 Webhook 告警通道已成功打通，后续可正常接收异常报警与用量提醒。",
    details: {
      gateway_app: c.env.APP_NAME || "Personal AI Gateway",
      test_status: "SUCCESS",
    },
    timestamp: Date.now(),
  });

  if (!result.ok) {
    return c.json({ ok: false, error: result.error || "发送测试通知失败" }, 400);
  }
  return c.json({ ok: true, status: result.status });
});

