import { beforeEach, describe, expect, it } from "vitest";
import {
  computeCacheKey,
  shouldBypassCache,
  getCachedEntry,
  setCachedEntry,
  clearMemoryCacheForTest,
  createCachedResponse,
  purgeCache,
  L1MemoryCache,
  type CachePayload,
} from "../src/gateway/cache";
import type { Env } from "../src/types";

describe("Multi-Tier Response Cache", () => {
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

  describe("L1 Memory Cache LRU", () => {
    it("evicts least recently accessed entries when reaching max size", () => {
      const smallCache = new L1MemoryCache(3);
      const dummyPayload = (text: string): CachePayload => ({
        kind: "chat/completions",
        model: "test-model",
        jsonBody: { text },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        createdAt: Date.now(),
      });

      smallCache.set("k1", dummyPayload("1"), 3600);
      smallCache.set("k2", dummyPayload("2"), 3600);
      smallCache.set("k3", dummyPayload("3"), 3600);

      // Access k1 to make it freshly used
      expect(smallCache.get("k1")?.jsonBody.text).toBe("1");

      // Add k4 -> should evict k2 (least recently accessed)
      smallCache.set("k4", dummyPayload("4"), 3600);

      expect(smallCache.get("k1")).not.toBeNull();
      expect(smallCache.get("k2")).toBeNull();
      expect(smallCache.get("k3")).not.toBeNull();
      expect(smallCache.get("k4")).not.toBeNull();
    });
  });

  describe("Cache Storage & Retrieval & Purge", () => {
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
        list: async () => ({ keys: Array.from(kvStore.keys()).map((name) => ({ name })) }),
        delete: async (k: string) => {
          kvStore.delete(k);
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

      await setCachedEntry(envWithKv, "aigw:cache:messages:claude-3-5-sonnet-20241022:hash123", payload, 3600);
      const retrieved = await getCachedEntry(envWithKv, "aigw:cache:messages:claude-3-5-sonnet-20241022:hash123");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.jsonBody.content[0].text).toBe("Claude Cached Content");

      // Test purge by model
      const purgeRes = await purgeCache(envWithKv, { model: "claude-3-5-sonnet-20241022" });
      expect(purgeRes.ok).toBe(true);

      const afterPurge = await getCachedEntry(envWithKv, "aigw:cache:messages:claude-3-5-sonnet-20241022:hash123");
      expect(afterPurge).toBeNull();
    });
  });

  describe("createCachedResponse with Reasoning & Function Calls", () => {
    it("synthesizes valid Responses API SSE events including reasoning delta and function call", async () => {
      const payload: CachePayload = {
        kind: "responses",
        model: "deepseek-r1",
        reasoning: "Thinking about holiday schedule...",
        jsonBody: {
          id: "resp_123",
          output: [
            { id: "item_reason", type: "reasoning", status: "completed" },
            { id: "item_msg", type: "message", role: "assistant", content: [{ type: "output_text", text: "Here is the date." }] },
            { id: "item_func", type: "function_call", call_id: "call_holiday", name: "exec_command", arguments: '{"cmd":"curl ..."}' },
          ],
        },
        usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 },
        createdAt: Date.now(),
      };

      const res = createCachedResponse(payload, "responses", true, "deepseek-r1", "req_resp_test");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("HIT");

      const text = await res.text();
      expect(text).toContain("response.created");
      expect(text).toContain("response.reasoning_text.delta");
      expect(text).toContain("Thinking about holiday schedule...");
      expect(text).toContain("Here is the date.");
      expect(text).toContain('"type":"function_call"');
      expect(text).toContain("call_holiday");
      expect(text).toContain("data: [DONE]");
    });
  });
});
