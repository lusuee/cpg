import { describe, it, expect, vi } from "vitest";
import {
  generateMonthlyReport,
  statsCostAnalytics,
  getDeviceMonthlyCost,
  createDevice,
  updateDevice,
} from "../src/db/repo";
import { formatMonthlyReportCsv } from "../src/admin/usage";
import type { Env, MonthlyReport } from "../src/types";

describe("Usage and Billing - Feature 1: Monthly Usage Report", () => {
  it("formats monthly report CSV with core sections", () => {
    const mockReport: MonthlyReport = {
      month: "2026-08",
      start_time: 1785542400000,
      end_time: 1788220799999,
      total_cost_usd: 12.45,
      total_requests: 350,
      total_input_tokens: 250000,
      total_output_tokens: 80000,
      total_tokens: 330000,
      cache_hit_count: 45,
      cache_saved_tokens: 45000,
      cache_saved_cost_usd: 1.25,
      by_provider: [
        {
          key: "p-openai",
          name: "OpenAI Official",
          request_count: 200,
          input_tokens: 150000,
          output_tokens: 50000,
          total_tokens: 200000,
          cost_usd: 8.5,
          share_percent: 68.3,
        },
      ],
      by_model: [
        {
          key: "gpt-4o",
          name: "gpt-4o",
          request_count: 180,
          input_tokens: 120000,
          output_tokens: 40000,
          total_tokens: 160000,
          cost_usd: 7.2,
          share_percent: 57.8,
        },
      ],
      by_device: [
        {
          key: "dev-1",
          name: "MacBook Cursor",
          request_count: 300,
          input_tokens: 220000,
          output_tokens: 70000,
          total_tokens: 290000,
          cost_usd: 11.0,
          share_percent: 88.4,
        },
      ],
      daily_trend: [
        {
          date: "2026-08-01",
          request_count: 50,
          total_tokens: 45000,
          cost_usd: 1.5,
        },
      ],
      mom_growth: {
        previous_month: "2026-07",
        previous_cost_usd: 10.0,
        previous_requests: 300,
        cost_growth_percent: 24.5,
        request_growth_percent: 16.7,
      },
    };

    const csv = formatMonthlyReportCsv(mockReport);
    expect(csv).toContain("CPG AI 网关月度账单报表 - 2026-08");
    expect(csv).toContain("总消耗金额 (USD),$12.4500");
    expect(csv).toContain("环比上月费用涨跌,24.5%");
    expect(csv).toContain("gpt-4o,180,120000,40000,160000,7.2000,57.8%");
    expect(csv).toContain("OpenAI Official,200,150000,50000,200000,8.5000,68.3%");
    expect(csv).toContain("MacBook Cursor,300,220000,70000,290000,11.0000,88.4%");
    expect(csv).toContain("2026-08-01,50,45000,1.5000");
  });

  it("handles generateMonthlyReport DB queries", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          total_requests: 120,
          total_cost_usd: 5.5,
          total_input_tokens: 100000,
          total_output_tokens: 30000,
          total_tokens: 130000,
          cache_hit_count: 20,
          cache_saved_tokens: 20000,
          cache_saved_cost_usd: 0.8,
          prev_requests: 100,
          prev_cost_usd: 5.0,
        }),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              key: "claude-3-5-sonnet",
              name: "Claude 3.5 Sonnet",
              request_count: 80,
              input_tokens: 60000,
              output_tokens: 20000,
              total_tokens: 80000,
              cost_usd: 4.0,
            },
          ],
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };

    const mockEnv = { DB: mockDb as any } as Env;
    const report = await generateMonthlyReport(mockEnv, "2026-08");

    expect(report.month).toBe("2026-08");
    expect(report.total_requests).toBe(120);
    expect(report.total_cost_usd).toBe(5.5);
    expect(report.by_provider).toBeDefined();
    expect(report.by_model).toBeDefined();
    expect(report.by_device).toBeDefined();
    expect(report.daily_trend).toBeDefined();
  });
});

describe("Usage and Billing - Feature 2: Per-Device Monthly Spending Limit", () => {
  it("queries getDeviceMonthlyCost correctly", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total_cost: 3.4567 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const cost = await getDeviceMonthlyCost(mockEnv, "dev-123");
    expect(cost).toBe(3.4567);
  });

  it("creates and updates device with cost_limit_monthly", async () => {
    let capturedBindArgs: any[] = [];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn((...args: any[]) => {
          capturedBindArgs = args;
          return {
            run: vi.fn().mockResolvedValue({ success: true }),
            first: vi.fn().mockResolvedValue({ id: "dev-test", name: "Test", cost_limit_monthly: 10 }),
            all: vi.fn().mockResolvedValue({ results: [] }),
          };
        }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const created = await createDevice(mockEnv, "Work Laptop", "token-hash-123", 60, 15.5);
    expect(created.name).toBe("Work Laptop");
    expect(created.cost_limit_monthly).toBe(15.5);

    const updated = await updateDevice(mockEnv, "dev-test", { cost_limit_monthly: 25.0 });
    expect(updated?.cost_limit_monthly).toBe(25.0);
  });
});

describe("Usage and Billing - Feature 3: Cost Anomaly Spike Detection & Model Ranking", () => {
  it("detects spending anomaly spike when daily spend exceeds 2.2x baseline", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn()
          .mockResolvedValueOnce({ total_cost: 25.0 }) // total cost query
          .mockResolvedValueOnce({ model: "claude-3-7-sonnet", model_cost: 12.0 }), // top driving model query
        all: vi.fn()
          .mockResolvedValueOnce({
            // model ranking query
            results: [
              {
                model: "claude-3-7-sonnet",
                request_count: 50,
                input_tokens: 100000,
                output_tokens: 50000,
                total_tokens: 150000,
                cost_usd: 15.0,
              },
              {
                model: "gpt-4o-mini",
                request_count: 200,
                input_tokens: 80000,
                output_tokens: 20000,
                total_tokens: 100000,
                cost_usd: 2.5,
              },
            ],
          })
          .mockResolvedValueOnce({
            // daily spend rows: baseline days around $1.00, spike day at $12.00
            results: [
              { date: "2026-08-19", request_count: 20, cost_usd: 1.0 },
              { date: "2026-08-20", request_count: 25, cost_usd: 1.2 },
              { date: "2026-08-21", request_count: 22, cost_usd: 0.9 },
              { date: "2026-08-22", request_count: 180, cost_usd: 12.0 },
            ],
          }),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const analytics = await statsCostAnalytics(mockEnv, Date.now() - 30 * 86400000);
    expect(analytics.total_cost_usd).toBe(25.0);
    expect(analytics.model_ranking.length).toBe(2);
    expect(analytics.model_ranking[0].model).toBe("claude-3-7-sonnet");
    expect(analytics.model_ranking[0].share_percent).toBe(60); // 15 / 25 = 60%

    expect(analytics.anomaly_alert.is_anomaly).toBe(true);
    expect(analytics.anomaly_alert.spike_date).toBe("2026-08-22");
    expect(analytics.anomaly_alert.spike_cost_usd).toBe(12.0);
    expect(analytics.anomaly_alert.message).toContain("2026-08-22 消费异常突增");
  });
});
