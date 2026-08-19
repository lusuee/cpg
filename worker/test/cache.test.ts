import { beforeEach, describe, expect, it } from "vitest";
import {
  computeCacheKey,
  shouldBypassCache,
  getCachedEntry,
  setCachedEntry,
  clearMemoryCacheForTest,
  createCachedResponse,
  type CachePayload,
} from "../src/gateway/cache";
import type { Env } from "../src/types";

describe("KV Response Cache", () => {
  beforeEach(() => {
    clearMemoryCacheForTest();
  });

  describe("computeCacheKey", () => {
    it("generates deterministic SHA-256 cache key regardless of object key order", async () => {
      const body1 = {
        model: "gpt-4o",
        temperature: 0.7,
        messages: [{ role: "user", content: "Hello" }],
      };
      const body2 = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        model: "gpt-4o",
      };

      const key1 = await computeCacheKey("chat/completions", "gpt-4o", body1);
      const key2 = await computeCacheKey("chat/completions", "gpt-4o", body2);

      expect(key1).toBe(key2);
      expect(key1.startsWith("aigw:cache:chat/completions:gpt-4o:")).toBe(true);
    });

    it("generates different keys for different inputs or parameters", async () => {
      const body1 = {
        model: "gpt-4o",
        temperature: 0.7,
        messages: [{ role: "user", content: "Hello" }],
      };
      const body2 = {
        model: "gpt-4o",
        temperature: 0.2,
        messages: [{ role: "user", content: "Hello" }],
      };
      const body3 = {
        model: "gpt-4o",
        temperature: 0.7,
        messages: [{ role: "user", content: "Hi" }],
      };

      const key1 = await computeCacheKey("chat/completions", "gpt-4o", body1);
      const key2 = await computeCacheKey("chat/completions", "gpt-4o", body2);
      const key3 = await computeCacheKey("chat/completions", "gpt-4o", body3);

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe("shouldBypassCache", () => {
    it("returns true when x-cache-bypass is true", () => {
      const headers = new Headers({ "x-cache-bypass": "true" });
      expect(shouldBypassCache(headers, {})).toBe(true);
    });

    it("returns true when cache-control contains no-cache", () => {
      const headers = new Headers({ "cache-control": "no-cache" });
      expect(shouldBypassCache(headers, {})).toBe(true);
    });

    it("returns false for standard requests", () => {
      const headers = new Headers();
      expect(shouldBypassCache(headers, {})).toBe(false);
    });
  });

  describe("Cache Storage & Retrieval", () => {
    const mockEnv: Env = {
      DB: {} as any,
      ASSETS: {} as any,
    };

    it("saves and retrieves cached payload in memory when KV is not bound", async () => {
      const payload: CachePayload = {
        kind: "chat/completions",
        model: "gpt-4o",
        jsonBody: { choices: [{ message: { role: "assistant", content: "Cached Hello" } }] },
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        createdAt: Date.now(),
      };

      await setCachedEntry(mockEnv, "test-key-1", payload, 3600);
      const retrieved = await getCachedEntry(mockEnv, "test-key-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.jsonBody.choices[0].message.content).toBe("Cached Hello");
      expect(retrieved?.usage.total_tokens).toBe(30);
    });

    it("uses KVNamespace when env.CACHE_KV is provided", async () => {
      const kvStore = new Map<string, string>();
      const mockKv = {
        get: async (k: string) => {
          const raw = kvStore.get(k);
          return raw ? JSON.parse(raw) : null;
        },
        put: async (k: string, v: string) => {
          kvStore.set(k, v);
        },
      };

      const envWithKv: Env = {
        ...mockEnv,
        CACHE_KV: mockKv as any,
      };

      const payload: CachePayload = {
        kind: "messages",
        model: "claude-3-5-sonnet-20241022",
        jsonBody: { content: [{ type: "text", text: "Claude Cached Content" }] },
        usage: { input_tokens: 15, output_tokens: 25, total_tokens: 40 },
        createdAt: Date.now(),
      };

      await setCachedEntry(envWithKv, "kv-test-key", payload, 3600);
      const retrieved = await getCachedEntry(envWithKv, "kv-test-key");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.jsonBody.content[0].text).toBe("Claude Cached Content");
    });
  });

  describe("createCachedResponse", () => {
    it("creates standard JSON response for non-streaming requests with X-Cache: HIT", async () => {
      const payload: CachePayload = {
        kind: "chat/completions",
        model: "gpt-4o",
        jsonBody: { id: "chatcmpl-cached", choices: [{ message: { content: "Fast answer" } }] },
        usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
        createdAt: Date.now(),
      };

      const res = createCachedResponse(payload, "chat/completions", false, "gpt-4o", "req_test");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("HIT");
      expect(res.headers.get("Content-Type")).toContain("application/json");

      const json = (await res.json()) as any;
      expect(json.choices[0].message.content).toBe("Fast answer");
    });

    it("synthesizes valid OpenAI SSE chunks for chat/completions stream requests", async () => {
      const payload: CachePayload = {
        kind: "chat/completions",
        model: "gpt-4o",
        jsonBody: { choices: [{ message: { content: "Streamed fast answer" }, finish_reason: "stop" }] },
        usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
        createdAt: Date.now(),
      };

      const res = createCachedResponse(payload, "chat/completions", true, "gpt-4o", "req_test");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("HIT");
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("data: ");
      expect(text).toContain("Streamed fast answer");
      expect(text).toContain("data: [DONE]");
    });

    it("synthesizes valid Anthropic SSE events for messages stream requests", async () => {
      const payload: CachePayload = {
        kind: "messages",
        model: "claude-3-5-sonnet-20241022",
        jsonBody: { id: "msg_123", content: [{ type: "text", text: "Claude streamed answer" }] },
        usage: { input_tokens: 8, output_tokens: 16, total_tokens: 24 },
        createdAt: Date.now(),
      };

      const res = createCachedResponse(payload, "messages", true, "claude-3-5-sonnet-20241022", "req_test");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("HIT");

      const text = await res.text();
      expect(text).toContain("event: message_start");
      expect(text).toContain("event: content_block_delta");
      expect(text).toContain("Claude streamed answer");
      expect(text).toContain("event: message_stop");
    });
  });
});
