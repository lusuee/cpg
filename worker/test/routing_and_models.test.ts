import { describe, expect, it } from "vitest";
import { inferModelCapabilities, buildModelCatalog } from "../src/gateway/catalog";
import { selectCandidateRoute } from "../src/gateway/routing";
import { parseRewriteRules, applyRequestRewriteRules } from "../src/gateway/rewrite";
import type { ModelRow, ModelWithProvider } from "../src/types";

describe("Model Capabilities Detection (Feature 4)", () => {
  it("detects vision, tool_call, reasoning, long_context, audio, code correctly", () => {
    expect(inferModelCapabilities("gpt-4o")).toContain("vision");
    expect(inferModelCapabilities("gpt-4o")).toContain("tool_call");
    expect(inferModelCapabilities("gpt-4o")).toContain("long_context");

    expect(inferModelCapabilities("deepseek-reasoner")).toContain("reasoning");
    expect(inferModelCapabilities("deepseek-r1")).toContain("reasoning");
    expect(inferModelCapabilities("o1-preview")).toContain("reasoning");
    expect(inferModelCapabilities("claude-3-7-sonnet")).toContain("reasoning");

    expect(inferModelCapabilities("gemini-2.0-flash-exp")).toContain("vision");
    expect(inferModelCapabilities("gemini-1.5-pro")).toContain("long_context");

    expect(inferModelCapabilities("qwen-2.5-coder-32b")).toContain("code");
    expect(inferModelCapabilities("deepseek-coder-v2")).toContain("code");

    expect(inferModelCapabilities("whisper-large-v3")).toContain("audio");
    expect(inferModelCapabilities("gpt-4o-audio-preview")).toContain("audio");
  });

  it("includes capabilities in buildModelCatalog output", () => {
    const mockModel: ModelRow = {
      id: "m-test",
      provider_id: "p1",
      model_name: "claude-3-5-sonnet-20241022",
      display_name: "Claude 3.5 Sonnet",
      alias: "claude-3.5",
      fallback_model_id: null,
      input_price_per_m: 3,
      output_price_per_m: 15,
      cache_enabled: 0,
      cache_ttl: 3600,
      enabled: 1,
      config_json: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const catalog = buildModelCatalog([mockModel]);
    expect(catalog.models.length).toBe(1);
    expect(catalog.models[0].capabilities).toContain("vision");
    expect(catalog.models[0].capabilities).toContain("tool_call");
  });
});

describe("Dynamic Routing Engine (Feature 2)", () => {
  const candidate1: ModelWithProvider = {
    id: "m1",
    provider_id: "prov-fast",
    provider_name: "Fast Provider",
    provider_type: "openai",
    provider_api_key: "sk-fast",
    provider_secret_name: null,
    provider_endpoint: null,
    model_name: "gpt-4o",
    display_name: "GPT-4o on Fast Provider",
    alias: "gpt-4o",
    fallback_model_id: null,
    input_price_per_m: 2.5,
    output_price_per_m: 10,
    cache_enabled: 0,
    cache_ttl: 3600,
    enabled: 1,
    config_json: JSON.stringify({ routing_strategy: "lowest_latency" }),
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  const candidate2: ModelWithProvider = {
    id: "m2",
    provider_id: "prov-slow",
    provider_name: "Slow Provider",
    provider_type: "openai",
    provider_api_key: "sk-slow",
    provider_secret_name: null,
    provider_endpoint: null,
    model_name: "gpt-4o",
    display_name: "GPT-4o on Slow Provider",
    alias: "gpt-4o",
    fallback_model_id: null,
    input_price_per_m: 2.5,
    output_price_per_m: 10,
    cache_enabled: 0,
    cache_ttl: 3600,
    enabled: 1,
    config_json: JSON.stringify({ routing_strategy: "lowest_latency" }),
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  it("selects the provider with lowest latency under lowest_latency strategy", () => {
    const latencies = new Map<string, number>([
      ["prov-fast", 150],
      ["prov-slow", 850],
    ]);

    const result = selectCandidateRoute([candidate2, candidate1], "gpt-4o", latencies);
    expect(result[0].provider_id).toBe("prov-fast");
    expect(result.length).toBe(2);
    expect(result[1].provider_id).toBe("prov-slow");
  });

  it("sorts by alias exact match in priority mode", () => {
    const directModel: ModelWithProvider = {
      ...candidate1,
      id: "m-direct",
      alias: "different-alias",
      model_name: "gpt-4o",
      config_json: null,
    };
    const aliasModel: ModelWithProvider = {
      ...candidate2,
      id: "m-alias",
      alias: "gpt-4o",
      model_name: "gpt-4o-2024-11-20",
      config_json: null,
    };

    const result = selectCandidateRoute([directModel, aliasModel], "gpt-4o");
    expect(result[0].id).toBe("m-alias");
  });

  it("supports weighted random candidate distribution", () => {
    const heavyCandidate: ModelWithProvider = {
      ...candidate1,
      id: "m-heavy",
      config_json: JSON.stringify({ routing_strategy: "weighted", weight: 90 }),
    };
    const lightCandidate: ModelWithProvider = {
      ...candidate2,
      id: "m-light",
      config_json: JSON.stringify({ routing_strategy: "weighted", weight: 10 }),
    };

    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 100; i++) {
      const res = selectCandidateRoute([heavyCandidate, lightCandidate], "gpt-4o");
      if (res[0].id === "m-heavy") counts.heavy++;
      else counts.light++;
    }

    expect(counts.heavy).toBeGreaterThan(counts.light);
  });
});

describe("Request Rewrite & System Prompt Injection (Feature 3)", () => {
  it("parses rewrite rules from config_json", () => {
    const config = JSON.stringify({
      system_prompt: "Answer like a pirate.",
      system_prompt_mode: "prepend",
      temperature_max: 0.7,
      max_tokens_limit: 1024,
      model_rewrite: "deepseek-ai/DeepSeek-V3",
    });

    const rules = parseRewriteRules(config);
    expect(rules).not.toBeNull();
    expect(rules?.system_prompt).toBe("Answer like a pirate.");
    expect(rules?.system_prompt_mode).toBe("prepend");
    expect(rules?.temperature_max).toBe(0.7);
    expect(rules?.max_tokens_limit).toBe(1024);
    expect(rules?.model_rewrite).toBe("deepseek-ai/DeepSeek-V3");
  });

  it("injects system prompt into OpenAI chat/completions payload (prepend mode)", () => {
    const rules = {
      system_prompt: "You are a code assistant.",
      system_prompt_mode: "prepend" as const,
    };

    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    };

    const rewritten = applyRequestRewriteRules(body, rules, "openai") as any;
    expect(rewritten.messages[0].role).toBe("system");
    expect(rewritten.messages[0].content).toBe("You are a code assistant.\n\nBe concise.");
  });

  it("injects system prompt into OpenAI chat/completions when no prior system prompt existed", () => {
    const rules = {
      system_prompt: "You are a code assistant.",
      system_prompt_mode: "prepend" as const,
    };

    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    };

    const rewritten = applyRequestRewriteRules(body, rules, "openai") as any;
    expect(rewritten.messages[0].role).toBe("system");
    expect(rewritten.messages[0].content).toBe("You are a code assistant.");
    expect(rewritten.messages[1].role).toBe("user");
  });

  it("overrides system prompt in override mode", () => {
    const rules = {
      system_prompt: "Strict override.",
      system_prompt_mode: "override" as const,
    };

    const body = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Original prompt" },
        { role: "user", content: "Hello" },
      ],
    };

    const rewritten = applyRequestRewriteRules(body, rules, "openai") as any;
    expect(rewritten.messages[0].content).toBe("Strict override.");
  });

  it("injects system prompt into Anthropic messages payload", () => {
    const rules = {
      system_prompt: "Anthropic injected prompt.",
      system_prompt_mode: "append" as const,
    };

    const body = {
      model: "claude-3-5-sonnet",
      system: "Existing system prompt.",
      messages: [{ role: "user", content: "Hello" }],
    };

    const rewritten = applyRequestRewriteRules(body, rules, "anthropic") as any;
    expect(rewritten.system).toBe("Existing system prompt.\n\nAnthropic injected prompt.");
  });

  it("clamps temperature and max_tokens", () => {
    const rules = {
      temperature_max: 0.5,
      max_tokens_limit: 500,
      model_rewrite: "custom-upstream-model",
    };

    const body = {
      model: "gpt-4o",
      temperature: 1.2,
      max_tokens: 4000,
      messages: [{ role: "user", content: "Hello" }],
    };

    const rewritten = applyRequestRewriteRules(body, rules, "openai") as any;
    expect(rewritten.temperature).toBe(0.5);
    expect(rewritten.max_tokens).toBe(500);
    expect(rewritten.model).toBe("custom-upstream-model");
  });
});
