import { describe, expect, it, beforeEach } from "vitest";
import { extractTextFromSse } from "../src/gateway/proxy";
import { checkAndRecordRateLimit, resetRateLimitMemory } from "../src/gateway/ratelimit";
import {
  CreateProviderSchema,
  CreateModelSchema,
  CreateDeviceSchema,
  LoginSchema,
  BatchCreateModelsSchema,
} from "../src/admin/schemas";
import type { Env } from "../src/types";

describe("Gateway SSE Text Extraction", () => {
  it("extracts text chunks from chat/completions SSE", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{"content":"!"}}]}',
      "data: [DONE]",
    ].join("\n");

    const text = extractTextFromSse("chat/completions", sse);
    expect(text).toBe("Hello world!");
  });

  it("extracts text chunks from Anthropic messages SSE", () => {
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi there"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":10}}',
      'data: {"type":"message_stop"}',
    ].join("\n");

    const text = extractTextFromSse("messages", sse);
    expect(text).toBe("Hi there!");
  });
});

describe("Real-time Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimitMemory();
  });

  it("allows requests under the RPM limit", async () => {
    const mockEnv: Env = { DB: {} as any, ASSETS: {} as any };
    const deviceId = "dev_test_1";
    const rpm = 5;

    for (let i = 0; i < 5; i++) {
      const allowed = await checkAndRecordRateLimit(mockEnv, deviceId, rpm);
      expect(allowed).toBe(true);
    }

    // 6th request should be blocked immediately
    const allowed6 = await checkAndRecordRateLimit(mockEnv, deviceId, rpm);
    expect(allowed6).toBe(false);
  });

  it("allows unlimited requests when rpm is 0", async () => {
    const mockEnv: Env = { DB: {} as any, ASSETS: {} as any };
    const deviceId = "dev_test_unlimited";

    for (let i = 0; i < 20; i++) {
      const allowed = await checkAndRecordRateLimit(mockEnv, deviceId, 0);
      expect(allowed).toBe(true);
    }
  });
});

describe("Admin Zod Schemas Validation", () => {
  describe("LoginSchema", () => {
    it("fails on empty password", () => {
      const res = LoginSchema.safeParse({ password: "" });
      expect(res.success).toBe(false);
    });

    it("passes on valid password", () => {
      const res = LoginSchema.safeParse({ password: "secret-password" });
      expect(res.success).toBe(true);
    });
  });

  describe("CreateProviderSchema", () => {
    it("fails on invalid type", () => {
      const res = CreateProviderSchema.safeParse({
        name: "Test Provider",
        type: "unknown_type",
      });
      expect(res.success).toBe(false);
    });

    it("fails on empty name", () => {
      const res = CreateProviderSchema.safeParse({
        name: "",
        type: "openai",
      });
      expect(res.success).toBe(false);
    });

    it("passes with valid attributes", () => {
      const res = CreateProviderSchema.safeParse({
        name: "OpenAI",
        type: "openai",
        endpoint: "https://api.openai.com/v1",
        secret_name: "OPENAI_API_KEY",
        enabled: true,
      });
      expect(res.success).toBe(true);
    });
  });

  describe("CreateModelSchema", () => {
    it("fails on negative price", () => {
      const res = CreateModelSchema.safeParse({
        provider_id: "prov_1",
        model_name: "gpt-4o",
        input_price_per_m: -10,
      });
      expect(res.success).toBe(false);
    });

    it("passes with valid pricing and defaults", () => {
      const res = CreateModelSchema.safeParse({
        provider_id: "prov_1",
        model_name: "gpt-4o",
        input_price_per_m: 2.5,
        output_price_per_m: 10,
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.cache_enabled).toBe(false);
        expect(res.data.cache_ttl).toBe(3600);
      }
    });
  });

  describe("CreateDeviceSchema", () => {
    it("fails on negative rate limit", () => {
      const res = CreateDeviceSchema.safeParse({
        name: "Laptop",
        rate_limit_rpm: -1,
      });
      expect(res.success).toBe(false);
    });

    it("passes with valid rate limit", () => {
      const res = CreateDeviceSchema.safeParse({
        name: "Laptop",
        rate_limit_rpm: 60,
      });
      expect(res.success).toBe(true);
    });
  });

  describe("BatchCreateModelsSchema", () => {
    it("fails on empty models list", () => {
      const res = BatchCreateModelsSchema.safeParse({
        provider_id: "prov_1",
        models: [],
      });
      expect(res.success).toBe(false);
    });

    it("accepts string array and object array", () => {
      const res = BatchCreateModelsSchema.safeParse({
        provider_id: "prov_1",
        models: [
          "claude-3-5-sonnet",
          { model_name: "claude-3-opus", display_name: "Claude 3 Opus" },
        ],
      });
      expect(res.success).toBe(true);
    });
  });
});

describe("Cloudflare Access Header Authentication & Security", () => {
  it("rejects spoofed CF-Access header when CF_ACCESS_ALLOWED_EMAILS is not configured", async () => {
    const { adminAuth } = await import("../src/middleware/adminAuth");
    let nextCalled = false;
    const mockContext: any = {
      req: {
        header: (k: string) => (k.toLowerCase() === "cf-access-authenticated-user-email" ? "attacker@example.com" : undefined),
      },
      env: {
        ADMIN_SECRET: "admin123",
      },
      json: (data: any, status?: number) => ({ data, status }),
    };

    const res: any = await adminAuth(mockContext, async () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.status).toBe(401);
  });

  it("accepts CF-Access header when email is in CF_ACCESS_ALLOWED_EMAILS whitelist", async () => {
    const { adminAuth } = await import("../src/middleware/adminAuth");
    let nextCalled = false;
    const mockContext: any = {
      req: {
        header: (k: string) => (k.toLowerCase() === "cf-access-authenticated-user-email" ? "admin@mycompany.com" : undefined),
      },
      env: {
        ADMIN_SECRET: "admin123",
        CF_ACCESS_ALLOWED_EMAILS: "dev@mycompany.com, admin@mycompany.com",
      },
      json: (data: any, status?: number) => ({ data, status }),
    };

    await adminAuth(mockContext, async () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe("Streaming Token Parsing with Head and Tail chunks", () => {
  it("correctly parses input_tokens from head chunk and output_tokens from tail chunk", async () => {
    const { parseUsage } = await import("../src/gateway/usage");
    const headChunk = 'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":125}}}\n';
    const middleChunk = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"processing..."}}\n';
    const tailChunk = 'data: {"type":"message_delta","usage":{"output_tokens":88}}\ndata: {"type":"message_stop"}\n';

    const combinedText = `${headChunk}\n${middleChunk}\n${tailChunk}`;
    const usage = parseUsage("anthropic", combinedText);

    expect(usage).not.toBeNull();
    expect(usage?.input_tokens).toBe(125);
    expect(usage?.output_tokens).toBe(88);
    expect(usage?.total_tokens).toBe(213);
  });
});

describe("Admin Login Rate Limiting (Brute-force protection)", () => {
  it("locks after 5 consecutive failed login attempts", async () => {
    const { authApp, resetLoginAttemptsForTest } = await import("../src/admin/auth");
    resetLoginAttemptsForTest();

    const env: Env = {
      DB: {} as any,
      ASSETS: {} as any,
      ADMIN_SECRET: "correct-secret",
    };

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await authApp.fetch(
        new Request("http://localhost/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": "1.2.3.4",
          },
          body: JSON.stringify({ password: "wrong-password" }),
        }),
        env
      );
      expect(res.status).toBe(401);
    }

    // 6th attempt should be locked with 429 Too Many Requests
    const lockedRes = await authApp.fetch(
      new Request("http://localhost/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "1.2.3.4",
        },
        body: JSON.stringify({ password: "correct-secret" }),
      }),
      env
    );
    expect(lockedRes.status).toBe(429);
    const body: any = await lockedRes.json();
    expect(body.error).toBe("too_many_attempts");

    // Different IP should still be able to login
    const otherIpRes = await authApp.fetch(
      new Request("http://localhost/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "5.6.7.8",
        },
        body: JSON.stringify({ password: "correct-secret" }),
      }),
      env
    );
    expect(otherIpRes.status).toBe(200);
  });
});


