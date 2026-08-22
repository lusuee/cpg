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

  it("handles listModelsHandler returning models and aliases", async () => {
    const { listModelsHandler } = await import("../src/gateway/proxy");
    const mockDb = {
      prepare: () => ({
        all: async () => ({
          results: [
            {
              id: "m1",
              model_name: "gpt-4o",
              display_name: "GPT-4o",
              alias: "gpt-4o-latest",
              fallback_model_id: null,
              input_price_per_m: 2.5,
              output_price_per_m: 10,
              created_at: 1700000000000,
              owned_by: "openai",
            },
          ],
        }),
      }),
    };

    const mockContext: any = {
      req: {
        header: (k: string) => (k.toLowerCase() === "authorization" ? "Bearer dkey_valid" : undefined),
      },
      env: {
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () => ({ id: "d1", name: "Dev Laptop", enabled: 1 }),
            }),
            all: mockDb.prepare().all,
          }),
        },
      },
      json: (data: any, status?: number) => ({ data, status: status || 200 }),
    };

    const res: any = await listModelsHandler(mockContext);
    expect(res.data.object).toBe("list");
    expect(res.data.data.length).toBe(2);
    expect(res.data.data.map((x: any) => x.id)).toEqual(["gpt-4o", "gpt-4o-latest"]);
  });

  it("handles getModelHandler for specific model", async () => {
    const { getModelHandler } = await import("../src/gateway/proxy");
    const mockContext: any = {
      req: {
        param: (p: string) => (p === "model" ? "gpt-4o" : undefined),
        header: (k: string) => (k.toLowerCase() === "authorization" ? "Bearer dkey_valid" : undefined),
      },
      env: {
        DB: {
          prepare: (sql: string) => ({
            bind: (...args: any[]) => ({
              first: async () => {
                if (args[0] === "dkey_valid") {
                  return { id: "d1", name: "Dev Laptop", enabled: 1 };
                }
                return {
                  id: "m1",
                  model_name: "gpt-4o",
                  display_name: "GPT-4o",
                  alias: "gpt-4o-latest",
                  provider_id: "prov_openai",
                  provider_name: "OpenAI",
                  provider_type: "openai",
                  enabled: 1,
                  provider_enabled: 1,
                  created_at: 1700000000000,
                };
              },
              all: async () => ({
                results: [
                  {
                    id: "m1",
                    model_name: "gpt-4o",
                    display_name: "GPT-4o",
                    alias: "gpt-4o-latest",
                    provider_id: "prov_openai",
                    provider_name: "OpenAI",
                    provider_type: "openai",
                    enabled: 1,
                    provider_enabled: 1,
                    created_at: 1700000000000,
                  },
                ],
              }),
            }),
          }),
        },
      },
      json: (data: any, status?: number) => ({ data, status: status || 200 }),
    };

    const res: any = await getModelHandler(mockContext);
    expect(res.data.id).toBe("gpt-4o");
    expect(res.data.object).toBe("model");
    expect(res.data.owned_by).toBe("OpenAI");
  });
});

