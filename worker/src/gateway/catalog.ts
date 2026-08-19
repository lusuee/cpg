import type { ModelRow } from "../types";

export interface ModelCatalogEntry {
  slug: string;
  display_name: string;
  description?: string;
  context_window: number;
  default_reasoning_level?: "none" | "low" | "medium" | "high" | null;
  supported_reasoning_levels?: Array<{ effort: string; description: string }>;
  input_modalities?: string[];
  supports_parallel_tool_calls?: boolean;
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
    name.includes("omni")
  ) {
    return ["text", "image"];
  }
  return ["text"];
}

export function buildModelCatalog(models: ModelRow[]): ModelCatalog {
  const catalogEntries: ModelCatalogEntry[] = [];

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
        : `${displayName} (${m.provider_id || "gateway"})`;

    const entry: ModelCatalogEntry = {
      slug,
      display_name: displayName,
      description,
      context_window: contextWindow,
      default_reasoning_level: reasoning ? "high" : null,
      supported_reasoning_levels: reasoning
        ? [
            { effort: "none", description: "Standard (no reasoning)" },
            { effort: "low", description: "Fast reasoning" },
            { effort: "medium", description: "Balanced reasoning" },
            { effort: "high", description: "Deep reasoning" },
          ]
        : [],
      input_modalities: inferInputModalities(m.model_name),
      supports_parallel_tool_calls: true,
      ...customConfig,
    };

    catalogEntries.push(entry);
  }

  return {
    models: catalogEntries,
  };
}
