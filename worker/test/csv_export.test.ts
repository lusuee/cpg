import { describe, expect, it } from "vitest";
import { escapeCsvField, formatUsageCsv } from "../src/admin/usage";
import type { UsageRow } from "../src/types";

describe("Usage CSV Export Formatter", () => {
  describe("escapeCsvField", () => {
    it("returns empty string for null and undefined", () => {
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("returns plain string if no special characters", () => {
      expect(escapeCsvField("gpt-4o")).toBe("gpt-4o");
      expect(escapeCsvField(123)).toBe("123");
    });

    it("escapes fields containing commas", () => {
      expect(escapeCsvField("openai,gemini")).toBe('"openai,gemini"');
    });

    it("escapes fields containing double quotes", () => {
      expect(escapeCsvField('hello "world"')).toBe('"hello ""world"""');
    });

    it("escapes fields containing newlines and carriage returns", () => {
      expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
      expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
    });
  });

  describe("formatUsageCsv", () => {
    it("generates valid RFC 4180 CSV with UTF-8 BOM and headers", () => {
      const mockItems: UsageRow[] = [
        {
          id: 1,
          device_id: "dev_laptop",
          provider_id: "prov_openai",
          provider_name: "OpenAI Official",
          model: "gpt-4o",
          input_tokens: 150,
          output_tokens: 300,
          total_tokens: 450,
          cost_usd: 0.003375,
          cache_hit: 0,
          status_code: 200,
          latency_ms: 850,
          request_id: "req_12345",
          created_at: 1735689600000, // 2025-01-01T00:00:00.000Z
        },
        {
          id: 2,
          device_id: "dev_phone",
          provider_id: "prov_anthropic",
          provider_name: "Anthropic Claude",
          model: "claude-3-5-sonnet-20241022",
          input_tokens: 500,
          output_tokens: 1000,
          total_tokens: 1500,
          cost_usd: 0,
          cache_hit: 1,
          status_code: 200,
          latency_ms: 12,
          request_id: "req_67890",
          created_at: 1735689660000,
        },
      ];

      const csv = formatUsageCsv(mockItems);

      // Check UTF-8 BOM
      expect(csv.charCodeAt(0)).toBe(0xfeff);

      const lines = csv.slice(1).split("\r\n");
      expect(lines.length).toBe(3); // Header + 2 data rows

      // Header verification
      expect(lines[0]).toBe(
        "ID,Time (UTC),Provider,Model,Device ID,Input Tokens,Output Tokens,Total Tokens,Cost (USD),Latency (ms),Status Code,Cache Hit,Request ID"
      );

      // Row 1 (Cache MISS)
      expect(lines[1]).toContain("gpt-4o");
      expect(lines[1]).toContain("NO");
      expect(lines[1]).toContain("0.003375");

      // Row 2 (Cache HIT)
      expect(lines[2]).toContain("claude-3-5-sonnet-20241022");
      expect(lines[2]).toContain("YES");
      expect(lines[2]).toContain("0.000000");
    });
  });
});
