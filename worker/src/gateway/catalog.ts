import type { ModelRow } from "../types";
import { catalogTemplate } from "./catalog_template";

export interface ModelCatalogEntry {
  additional_speed_tiers: any[];
  apply_patch_tool_type: string;
  availability_nux: any;
  base_instructions: string;
  context_window: number;
  default_reasoning_level: string | null;
  default_reasoning_summary: string;
  default_verbosity: string;
  description: string;
  display_name: string;
  effective_context_window_percent: number;
  experimental_supported_tools: any[];
  input_modalities: string[];
  max_context_window: number;
  model_messages: {
    instructions_template: string;
    instructions_variables: {
      personality_default: string;
      personality_friendly: string;
      personality_pragmatic: string;
    };
  };
  priority: number;
  service_tiers: any[];
  shell_type: string;
  slug: string;
  support_verbosity: boolean;
  supported_in_api: boolean;
  supported_reasoning_levels: Array<{ description: string; effort: string }>;
  supports_image_detail_original: boolean;
  supports_parallel_tool_calls: boolean;
  supports_reasoning_summaries: boolean;
  supports_search_tool: boolean;
  truncation_policy: { limit: number; mode: string };
  upgrade: any;
  visibility: string;
  web_search_tool_type: string;
  [key: string]: any;
}

export interface ModelCatalog {
  models: ModelCatalogEntry[];
}

export function inferContextWindow(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes("gemini-1.5") || name.includes("gemini-2.0") || name.includes("gemini-2.5")) {
    return 1048576;
  }
  if (name.includes("claude-3") || name.includes("claude-2")) {
    return 200000;
  }
  if (name.includes("o1") || name.includes("o3")) {
    return 200000;
  }
  if (name.includes("deepseek") || name.includes("qwen") || name.includes("qwq") || name.includes("llama-3")) {
    return 131072;
  }
  if (name.includes("gpt-4o") || name.includes("gpt-4-turbo") || name.includes("gpt-4")) {
    return 128000;
  }
  if (name.includes("gpt-3.5-turbo-16k")) {
    return 16384;
  }
  if (name.includes("gpt-3.5")) {
    return 4096;
  }
  return 128000;
}

export function isReasoningModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  return (
    name.includes("r1") ||
    name.includes("reason") ||
    name.includes("thinking") ||
    name.includes("thought") ||
    name.includes("qwq") ||
    name.startsWith("o1") ||
    name.startsWith("o3") ||
    name.includes("claude-3-7") ||
    name.includes("claude-3.7")
  );
}

export function inferInputModalities(modelName: string): string[] {
  const name = modelName.toLowerCase();
  if (
    name.includes("4o") ||
    name.includes("vision") ||
    name.includes("vl") ||
    name.includes("gemini") ||
    name.includes("claude-3") ||
    name.includes("pixtral") ||
    name.includes("omni") ||
    name.includes("kimi")
  ) {
    return ["text", "image"];
  }
  return ["text"];
}

export function buildModelCatalog(models: ModelRow[]): ModelCatalog {
  const catalogEntries: ModelCatalogEntry[] = [];
  let priorityCounter = 1000;

  for (const m of models) {
    if (!m.enabled) continue;

    const slug = m.alias || m.model_name;
    const displayName = m.display_name || m.alias || m.model_name;
    const reasoning = isReasoningModel(m.model_name) || Boolean(m.alias && isReasoningModel(m.alias));

    let customConfig: Record<string, any> = {};
    if (m.config_json) {
      try {
        customConfig = JSON.parse(m.config_json);
      } catch {
        // ignore invalid json
      }
    }

    const contextWindow =
      typeof customConfig.context_window === "number"
        ? customConfig.context_window
        : inferContextWindow(m.model_name);

    const description =
      typeof customConfig.description === "string"
        ? customConfig.description
        : displayName;

    const reasoningLevels = [
      {
        description: "Fast responses with lighter reasoning",
        effort: "low",
      },
      {
        description: "Balances speed and reasoning depth for everyday tasks",
        effort: "medium",
      },
      {
        description: "Greater reasoning depth for complex problems",
        effort: "high",
      },
      {
        description: "Extra high reasoning depth for complex problems",
        effort: "xhigh",
      },
    ];

    const entry: ModelCatalogEntry = {
      additional_speed_tiers: [],
      apply_patch_tool_type: "freeform",
      availability_nux: null,
      base_instructions: customConfig.base_instructions || catalogTemplate.base_instructions,
      context_window: contextWindow,
      default_reasoning_level: customConfig.default_reasoning_level ?? (reasoning ? "medium" : "medium"),
      default_reasoning_summary: "none",
      default_verbosity: "low",
      description,
      display_name: displayName,
      effective_context_window_percent: customConfig.effective_context_window_percent ?? 95,
      experimental_supported_tools: [],
      input_modalities: customConfig.input_modalities || inferInputModalities(m.model_name),
      max_context_window: customConfig.max_context_window ?? contextWindow,
      model_messages: customConfig.model_messages || catalogTemplate.model_messages,
      priority: customConfig.priority ?? priorityCounter++,
      service_tiers: [],
      shell_type: "shell_command",
      slug,
      support_verbosity: true,
      supported_in_api: true,
      supported_reasoning_levels: customConfig.supported_reasoning_levels || reasoningLevels,
      supports_image_detail_original: true,
      supports_parallel_tool_calls: true,
      supports_reasoning_summaries: true,
      supports_search_tool: true,
      truncation_policy: customConfig.truncation_policy || { limit: 10000, mode: "tokens" },
      upgrade: null,
      visibility: "list",
      web_search_tool_type: "text_and_image",
      ...customConfig,
    };

    catalogEntries.push(entry);
  }

  return {
    models: catalogEntries,
  };
}
