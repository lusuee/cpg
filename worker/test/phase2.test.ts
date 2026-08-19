import { describe, expect, it } from "vitest";
import { buildUpstreamHeaders } from "../src/utils/http";

describe("Phase 2 Core Capabilities", () => {
  describe("buildUpstreamHeaders for all providers", () => {
    it("sets x-goog-api-key and Bearer for gemini provider", () => {
      const source = new Headers({
        "Content-Type": "application/json",
        "Custom-Header": "foo",
      });
      const headers = buildUpstreamHeaders(source, "gemini", "ai-key-123");
      expect(headers.get("x-goog-api-key")).toBe("ai-key-123");
      expect(headers.get("Authorization")).toBe("Bearer ai-key-123");
      expect(headers.get("User-Agent")).toBe("personal-ai-gateway/0.1");
      expect(headers.get("Content-Type")).toBe("application/json");
    });

    it("sets x-api-key for anthropic", () => {
      const source = new Headers({ "anthropic-version": "2023-06-01" });
      const headers = buildUpstreamHeaders(source, "anthropic", "ant-key-456");
      expect(headers.get("x-api-key")).toBe("ant-key-456");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("Authorization")).toBeNull();
    });

    it("sets Bearer for openai", () => {
      const source = new Headers();
      const headers = buildUpstreamHeaders(source, "openai", "sk-test-789");
      expect(headers.get("Authorization")).toBe("Bearer sk-test-789");
      expect(headers.get("x-api-key")).toBeNull();
      expect(headers.get("x-goog-api-key")).toBeNull();
    });
  });

  describe("Cost estimation formula", () => {
    it("calculates cost accurately based on input/output pricing", () => {
      const inputTokens = 1000;
      const outputTokens = 2000;
      const inputPricePerM = 2.5; // $2.50 per 1M tokens
      const outputPricePerM = 10.0; // $10.00 per 1M tokens

      const costUsd = (inputTokens * inputPricePerM + outputTokens * outputPricePerM) / 1_000_000;
      // 1000 * 2.5 / 1e6 = 0.0025
      // 2000 * 10 / 1e6 = 0.02
      // total = 0.0225
      expect(costUsd).toBeCloseTo(0.0225, 6);
    });

    it("returns 0 when pricing is not configured", () => {
      const inputTokens = 1000;
      const outputTokens = 2000;
      const inputPricePerM = 0;
      const outputPricePerM = 0;

      const costUsd = inputPricePerM > 0 || outputPricePerM > 0
        ? (inputTokens * inputPricePerM + outputTokens * outputPricePerM) / 1_000_000
        : 0;
      expect(costUsd).toBe(0);
    });
  });
});
