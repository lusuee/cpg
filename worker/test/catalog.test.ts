import { describe, expect, it } from "vitest";
import {
  buildModelCatalog,
  inferContextWindow,
  isReasoningModel,
  inferInputModalities,
} from "../src/gateway/catalog";
import type { ModelRow } from "../src/types";

describe("Model Catalog Builder (model-catalog.json)", () => {
  it("infers context window correctly for different model families", () => {
    expect(inferContextWindow("gemini-2.0-flash")).toBe(1048576);
    expect(inferContextWindow("claude-3-5-sonnet-20241022")).toBe(200000);
    expect(inferContextWindow("deepseek-chat")).toBe(131072);
    expect(inferContextWindow("gpt-4o")).toBe(128000);
    expect(inferContextWindow("custom-model")).toBe(128000);
  });

  it("detects reasoning models correctly", () => {
    expect(isReasoningModel("deepseek-r1")).toBe(true);
    expect(isReasoningModel("gemini-2.0-flash-thinking-exp-01-21")).toBe(true);
    expect(isReasoningModel("qwq-32b")).toBe(true);
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("o3-mini")).toBe(true);
    expect(isReasoningModel("claude-3-7-sonnet")).toBe(true);
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("claude-3-5-sonnet")).toBe(false);
  });

  it("infers multimodal input modalities", () => {
    expect(inferInputModalities("gpt-4o")).toEqual(["text", "image"]);
    expect(inferInputModalities("claude-3-5-sonnet-20241022")).toEqual(["text", "image"]);
    expect(inferInputModalities("gemini-2.0-flash")).toEqual(["text", "image"]);
    expect(inferInputModalities("deepseek-chat")).toEqual(["text"]);
  });

  it("builds a valid model catalog from active model rows", () => {
    const mockModels: ModelRow[] = [
      {
        id: "m1",
        provider_id: "prov_openai",
        model_name: "gpt-4o",
        display_name: "GPT-4o Flagship",
        alias: "gpt-4o-latest",
        fallback_model_id: null,
        input_price_per_m: 2.5,
        output_price_per_m: 10,
        cache_enabled: 0,
        cache_ttl: 3600,
        enabled: 1,
        config_json: JSON.stringify({ custom_tag: "fast" }),
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      {
        id: "m2",
        provider_id: "prov_deepseek",
        model_name: "deepseek-reasoner",
        display_name: "DeepSeek R1",
        alias: "deepseek-r1",
        fallback_model_id: null,
        input_price_per_m: 0.55,
        output_price_per_m: 2.19,
        cache_enabled: 0,
        cache_ttl: 3600,
        enabled: 1,
        config_json: JSON.stringify({ apply_patch_tool_type: "function" }),
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      {
        id: "m3",
        provider_id: "prov_disabled",
        model_name: "disabled-model",
        display_name: "Disabled",
        alias: null,
        fallback_model_id: null,
        input_price_per_m: 0,
        output_price_per_m: 0,
        cache_enabled: 0,
        cache_ttl: 3600,
        enabled: 0, // disabled
        config_json: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ];

    const catalog = buildModelCatalog(mockModels);

    expect(catalog.models.length).toBe(2);

    // Model 1: gpt-4o-latest
    const m1 = catalog.models.find((x) => x.slug === "gpt-4o-latest");
    expect(m1).toBeDefined();
    expect(m1?.display_name).toBe("GPT-4o Flagship");
    expect(m1?.context_window).toBe(128000);
    expect(m1?.max_context_window).toBe(128000);
    expect(m1?.effective_context_window_percent).toBe(95);
    expect(m1?.shell_type).toBe("shell_command");
    expect(m1?.apply_patch_tool_type).toBe("freeform");
    expect(m1?.web_search_tool_type).toBe("text_and_image");
    expect(m1?.base_instructions).toContain("You are Codex");
    expect(m1?.model_messages?.instructions_template).toContain("You are Codex");
    expect(m1?.model_messages?.instructions_variables?.personality_friendly).toBeDefined();
    expect(m1?.input_modalities).toEqual(["text", "image"]);
    expect((m1 as any)?.custom_tag).toBe("fast");

    // Model 2: deepseek-r1
    const m2 = catalog.models.find((x) => x.slug === "deepseek-r1");
    expect(m2).toBeDefined();
    expect(m2?.display_name).toBe("DeepSeek R1");
    expect(m2?.apply_patch_tool_type).toBe("function");
    expect(m2?.supported_reasoning_levels?.length).toBeGreaterThan(0);
    expect(m2?.priority).toBe(1001);
  });
});
