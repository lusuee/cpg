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
