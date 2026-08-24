import { describe, it, expect, vi } from "vitest";
import { isIpAllowed, isIpInCidr, extractClientIp } from "../src/middleware/adminAuth";
import {
  recordAuditLog,
  listAuditLogs,
  createConfigSnapshot,
  listConfigSnapshots,
  getConfigSnapshot,
  restoreConfigSnapshot,
  getKeyRotationReport,
} from "../src/db/repo";
import { generateOpenApiSpec } from "../src/gateway/openapi";
import type { Env } from "../src/types";

describe("Security & Access Control - Feature 1: IP Whitelist & CIDR Matching", () => {
  it("correctly checks exact IPs and wildcard", () => {
    expect(isIpAllowed("192.168.1.50", ["192.168.1.50"])).toBe(true);
    expect(isIpAllowed("192.168.1.51", ["192.168.1.50"])).toBe(false);
    expect(isIpAllowed("10.0.0.1", ["*"])).toBe(true);
    expect(isIpAllowed("127.0.0.1", ["localhost"])).toBe(true);
  });

  it("correctly checks CIDR subnet ranges", () => {
    expect(isIpInCidr("192.168.1.15", "192.168.1.0/24")).toBe(true);
    expect(isIpInCidr("192.168.2.1", "192.168.1.0/24")).toBe(false);
    expect(isIpInCidr("10.25.100.5", "10.0.0.0/8")).toBe(true);
    expect(isIpInCidr("172.16.0.5", "10.0.0.0/8")).toBe(false);
    expect(isIpAllowed("10.5.5.5", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("192.168.1.1", ["10.0.0.0/8"])).toBe(false);
  });

  it("extracts client IP from Cloudflare or forward headers", () => {
    expect(
      extractClientIp({
        req: {
          header: (h: string) => (h === "cf-connecting-ip" ? "203.0.113.195" : undefined),
        },
      } as any)
    ).toBe("203.0.113.195");

    expect(
      extractClientIp({
        req: {
          header: (h: string) => (h === "x-forwarded-for" ? "198.51.100.4, 10.0.0.1" : undefined),
        },
      } as any)
    ).toBe("198.51.100.4");
  });
});

describe("Security & Compliance - Feature 2: Audit Logs & Activity Trail", () => {
  it("records and lists admin audit logs", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 1 }),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: 1,
              actor_type: "admin",
              ip: "1.2.3.4",
              action: "provider.create",
              target_type: "provider",
              target_id: "prov-1",
              summary: "创建 Provider",
              details_json: '{"name":"OpenAI"}',
              created_at: 1785542400000,
            },
          ],
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    await recordAuditLog(mockEnv, {
      ip: "1.2.3.4",
      action: "provider.create",
      target_type: "provider",
      target_id: "prov-1",
      summary: "创建 Provider",
    });

    const result = await listAuditLogs(mockEnv, { limit: 10 });
    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0].action).toBe("provider.create");
  });
});

describe("Security & Compliance - Feature 3: API Key Rotation & Lifecycle", () => {
  it("computes key ages and classifies statuses", async () => {
    const nowMs = Date.now();
    const DAY_MS = 86400000;

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn()
          .mockResolvedValueOnce({
            results: [
              {
                id: "p1",
                name: "Old Provider",
                type: "openai",
                api_key: "sk-abcdef123456",
                created_at: nowMs - 100 * DAY_MS,
                updated_at: nowMs - 100 * DAY_MS,
                enabled: 1,
              },
              {
                id: "p2",
                name: "Fresh Provider",
                type: "anthropic",
                api_key: "sk-fresh987654",
                created_at: nowMs - 10 * DAY_MS,
                enabled: 1,
              },
            ],
          })
          .mockResolvedValueOnce({
            results: [],
          }),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const report = await getKeyRotationReport(mockEnv, 90);
    expect(report.recommended_rotation_days).toBe(90);
    expect(report.expired_count).toBe(1);
    expect(report.fresh_count).toBe(1);
    expect(report.items[0].status).toBe("expired");
    expect(report.items[0].age_days).toBeGreaterThanOrEqual(100);
  });
});

describe("Developer Experience - Feature 4 & 5: Config Snapshots & Rollback", () => {
  it("creates and retrieves config snapshots", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: "snap-123",
              name: "Test Snapshot",
              description: "Backup description",
              size_bytes: 512,
              created_at: 1785542400000,
            },
          ],
        }),
        first: vi.fn().mockResolvedValue({
          id: "snap-123",
          name: "Test Snapshot",
          description: "Backup description",
          snapshot_json: JSON.stringify({ providers: [], models: [] }),
          created_at: 1785542400000,
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const snap = await createConfigSnapshot(mockEnv, "Test Snapshot", "Backup description");
    expect(snap.name).toBe("Test Snapshot");

    const list = await listConfigSnapshots(mockEnv);
    expect(list.length).toBe(1);

    const rollbackResult = await restoreConfigSnapshot(mockEnv, "snap-123");
    expect(rollbackResult.success).toBe(true);
  });
});

describe("Developer Experience - Feature 6: Dynamic OpenAPI 3.0 Generator", () => {
  it("generates valid OpenAPI 3.0 specification", async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: [
            {
              id: "m-1",
              provider_id: "p-1",
              model_name: "gpt-4o",
              alias: "chatgpt",
              enabled: 1,
            },
          ],
        }),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    const mockEnv = { DB: mockDb as any } as Env;

    const spec = await generateOpenApiSpec(mockEnv, "https://ai.mygateway.com");
    expect(spec.openapi).toBe("3.0.3");
    expect((spec.info as any).title).toContain("AI Gateway");
    expect((spec.paths as any)["/v1/chat/completions"]).toBeDefined();
    expect((spec.paths as any)["/v1/messages"]).toBeDefined();
    expect((spec.paths as any)["/v1/models"]).toBeDefined();
    expect((spec.components as any).securitySchemes.BearerAuth).toBeDefined();
  });
});
