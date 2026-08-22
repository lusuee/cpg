import { describe, it, expect, beforeEach } from "vitest";
import type { Env } from "../src/types";
import { buildPlatformPayload } from "../src/utils/webhook";
import { usageApp } from "../src/admin/usage";
import { settingsApp } from "../src/admin/settings";

describe("1. Universal Webhook Dispatcher Platform Formatters", () => {
  const samplePayload = {
    event: "budget_exceeded" as const,
    title: "月度预算超额告警",
    message: "累计消费已达到月度上限 $10.00",
    details: { current_spend: 10.5, budget: 10.0 },
    timestamp: 1700000000000,
  };

  it("formats payload for Feishu / Lark robot", () => {
    const { body, headers } = buildPlatformPayload("https://open.feishu.cn/open-apis/bot/v2/hook/abc", samplePayload);
    expect(headers["Content-Type"]).toBe("application/json");
    const json = JSON.parse(body);
    expect(json.msg_type).toBe("text");
    expect(json.content.text).toContain("月度预算超额告警");
  });

  it("formats payload for DingTalk robot", () => {
    const { body } = buildPlatformPayload("https://oapi.dingtalk.com/robot/send?access_token=abc", samplePayload);
    const json = JSON.parse(body);
    expect(json.msgtype).toBe("markdown");
    expect(json.markdown.title).toBe("月度预算超额告警");
    expect(json.markdown.text).toContain("月度预算超额告警");
  });

  it("formats payload for WeCom (企业微信) robot", () => {
    const { body } = buildPlatformPayload("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc", samplePayload);
    const json = JSON.parse(body);
    expect(json.msgtype).toBe("markdown");
    expect(json.markdown.content).toContain("月度预算超额告警");
  });

  it("formats payload for Slack Incoming Webhook", () => {
    const { body } = buildPlatformPayload("https://hooks.slack.com/services/T00/B00/X00", samplePayload);
    const json = JSON.parse(body);
    expect(json.text).toContain("*月度预算超额告警*");
    expect(json.attachments).toBeDefined();
  });

  it("formats payload for Discord Webhook", () => {
    const { body } = buildPlatformPayload("https://discord.com/api/webhooks/123/abc", samplePayload);
    const json = JSON.parse(body);
    expect(json.content).toContain("**月度预算超额告警**");
    expect(json.embeds).toBeDefined();
  });

  it("formats payload for Generic Custom Webhook", () => {
    const { body } = buildPlatformPayload("https://my-server.com/api/gateway-alert", samplePayload);
    const json = JSON.parse(body);
    expect(json.event).toBe("budget_exceeded");
    expect(json.title).toBe("月度预算超额告警");
    expect(json.details.current_spend).toBe(10.5);
  });
});

describe("2. Live Request Log Stream & Latest Endpoint", () => {
  it("fetches latest incremental logs via GET /api/usage/latest", async () => {
    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            all: async () => ({
              results: [
                { id: 105, model: "gpt-4o", total_tokens: 150, status_code: 200, latency_ms: 320, created_at: Date.now() },
                { id: 104, model: "claude-3-5-sonnet", total_tokens: 280, status_code: 200, latency_ms: 650, created_at: Date.now() - 1000 },
              ],
            }),
          }),
        }),
      },
    } as any;

    const res = await usageApp.fetch(new Request("http://localhost/latest?after_id=103&limit=10"), mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.items.length).toBe(2);
    expect(data.items[0].id).toBe(105);
    expect(data.count).toBe(2);
  });
});

describe("3. Cache Analytics & Speedup Benchmark", () => {
  it("computes cache hit rate, savings, and acceleration ratio via GET /api/usage/cache-stats", async () => {
    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            first: async () => ({
              total_requests: 100,
              cache_hits: 25,
              tokens_saved: 12500,
              cost_saved_usd: 0.0625,
              avg_cached_latency_ms: 12,
              avg_direct_latency_ms: 480,
            }),
          }),
        }),
      },
    } as any;

    const res = await usageApp.fetch(new Request("http://localhost/cache-stats?range=today"), mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.total_requests).toBe(100);
    expect(data.cache_hits).toBe(25);
    expect(data.cache_hit_rate).toBe(25);
    expect(data.tokens_saved).toBe(12500);
    expect(data.cost_saved_usd).toBe(0.0625);
    expect(data.avg_cached_latency_ms).toBe(12);
    expect(data.acceleration_ratio).toBe(40); // 480 / 12 = 40x
  });
});

describe("4. Multi-Model Latency Benchmark", () => {
  it("returns model latency ranking via GET /api/usage/model-latency", async () => {
    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            all: async () => ({
              results: [
                { model: "gemini-2.0-flash", provider_name: "Google", requests: 50, avg_latency_ms: 220, min_latency_ms: 110, max_latency_ms: 550, error_count: 0 },
                { model: "gpt-4o-mini", provider_name: "OpenAI", requests: 80, avg_latency_ms: 380, min_latency_ms: 190, max_latency_ms: 950, error_count: 1 },
                { model: "claude-3-5-sonnet", provider_name: "Anthropic", requests: 30, avg_latency_ms: 850, min_latency_ms: 450, max_latency_ms: 1600, error_count: 0 },
              ],
            }),
          }),
        }),
      },
    } as any;

    const res = await usageApp.fetch(new Request("http://localhost/model-latency?range=today"), mockEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.items.length).toBe(3);
    expect(data.items[0].model).toBe("gemini-2.0-flash");
    expect(data.items[0].avg_latency_ms).toBe(220);
    expect(data.items[1].model).toBe("gpt-4o-mini");
    expect(data.items[1].error_rate).toBe(1.3); // 1 / 80 = 1.25 -> 1.3%
  });
});

describe("5. Monthly Budget & Quota Control API", () => {
  let storedSettings: Record<string, string> = {};

  const mockEnv = {
    DB: {
      prepare: (sql: string) => {
        const handler = {
          first: async () => {
            if (sql.includes("SELECT COALESCE(SUM(cost_usd), 0)")) {
              return { total_cost: 4.85 };
            }
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        };
        return {
          ...handler,
          bind: (...args: any[]) => ({
            first: async () => {
              if (sql.includes("SELECT value_json FROM settings WHERE key = ?")) {
                const key = args[0];
                return storedSettings[key] ? { value_json: storedSettings[key] } : null;
              }
              if (sql.includes("SELECT COALESCE(SUM(cost_usd), 0)")) {
                return { total_cost: 4.85 };
              }
              return null;
            },
            run: async () => {
              if (sql.includes("INSERT OR REPLACE INTO settings")) {
                const key = args[0];
                const val = args[1];
                storedSettings[key] = val;
              }
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
  } as any;

  beforeEach(() => {
    storedSettings = {};
  });

  it("reads and updates monthly budget configuration", async () => {
    // 1. Initial read (default 0)
    const getRes1 = await settingsApp.fetch(new Request("http://localhost/budget"), mockEnv);
    const data1 = (await getRes1.json()) as any;
    expect(data1.monthly_budget_usd).toBe(0);
    expect(data1.spent_this_month_usd).toBe(4.85);

    // 2. Update budget to $15.00 with block strategy
    const putRes = await settingsApp.fetch(
      new Request("http://localhost/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly_budget_usd: 15.0,
          budget_action: "block",
          alert_threshold_pct: 85,
        }),
      }),
      mockEnv
    );
    expect(putRes.status).toBe(200);

    // 3. Read back updated budget
    const getRes2 = await settingsApp.fetch(new Request("http://localhost/budget"), mockEnv);
    const data2 = (await getRes2.json()) as any;
    expect(data2.monthly_budget_usd).toBe(15.0);
    expect(data2.budget_action).toBe("block");
    expect(data2.alert_threshold_pct).toBe(85);
    expect(data2.spent_this_month_usd).toBe(4.85);
  });

  it("updates and tests webhook configuration", async () => {
    // 1. Save webhook
    const putRes = await settingsApp.fetch(
      new Request("http://localhost/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://open.feishu.cn/open-apis/bot/v2/hook/mock",
          secret: "secret-token",
          events: ["budget_exceeded", "provider_error"],
        }),
      }),
      mockEnv
    );
    expect(putRes.status).toBe(200);

    // 2. Read webhook config (secret masked)
    const getRes = await settingsApp.fetch(new Request("http://localhost/webhook"), mockEnv);
    const data = (await getRes.json()) as any;
    expect(data.url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/mock");
    expect(data.secret_configured).toBe(true);
    expect(data.events).toContain("budget_exceeded");
  });
});
