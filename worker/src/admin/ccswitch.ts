import type { ProviderType } from "../types";

export interface ParsedCcSwitchModel {
  model_name: string;
  display_name?: string;
  alias?: string;
  input_price_per_m?: number;
  output_price_per_m?: number;
}

export interface ParsedCcSwitchProvider {
  name: string;
  type: ProviderType;
  endpoint: string | null;
  api_key: string | null;
  enabled: boolean;
  models: ParsedCcSwitchModel[];
  raw_config?: Record<string, any>;
}

/**
 * Normalizes provider type based on app_type, endpoint, or raw type strings.
 */
export function inferProviderType(
  appType?: string | null,
  endpoint?: string | null,
  rawType?: string | null
): ProviderType {
  const normApp = (appType || "").toLowerCase().trim();
  const normType = (rawType || "").toLowerCase().trim();
  const normEp = (endpoint || "").toLowerCase().trim();

  if (normApp === "claude" || normApp === "claude-code" || normType === "anthropic") {
    return "anthropic";
  }
  if (normApp === "gemini" || normType === "gemini" || normEp.includes("generativelanguage.googleapis.com")) {
    return "gemini";
  }
  if (
    normApp === "codex" ||
    normApp === "openai" ||
    normApp === "opencode" ||
    normApp === "openclaw" ||
    normApp === "hermes" ||
    normType === "openai"
  ) {
    return "openai";
  }

  // Infer from endpoint URL
  if (normEp.includes("anthropic.com") || normEp.includes("claude")) {
    return "anthropic";
  }
  if (normEp.includes("googleapis.com") || normEp.includes("gemini")) {
    return "gemini";
  }
  return "openai";
}

/**
 * Returns default suggested models for common provider types / endpoints
 * if none are explicitly configured in the CC-Switch export.
 */
export function getDefaultModelsForProvider(
  type: ProviderType,
  endpoint?: string | null
): ParsedCcSwitchModel[] {
  const ep = (endpoint || "").toLowerCase();

  if (ep.includes("deepseek.com")) {
    return [
      { model_name: "deepseek-chat", display_name: "DeepSeek V3", alias: "deepseek-v3" },
      { model_name: "deepseek-reasoner", display_name: "DeepSeek R1", alias: "deepseek-r1" },
    ];
  }
  if (ep.includes("siliconflow.cn")) {
    return [
      { model_name: "deepseek-ai/DeepSeek-V3", display_name: "DeepSeek V3 (SiliconFlow)", alias: "deepseek-v3" },
      { model_name: "deepseek-ai/DeepSeek-R1", display_name: "DeepSeek R1 (SiliconFlow)", alias: "deepseek-r1" },
    ];
  }
  if (ep.includes("bigmodel.cn")) {
    return [
      { model_name: "glm-4-plus", display_name: "GLM-4 Plus", alias: "glm-4" },
      { model_name: "glm-4-flash", display_name: "GLM-4 Flash", alias: "glm-4-flash" },
    ];
  }
  if (ep.includes("moonshot.cn")) {
    return [
      { model_name: "moonshot-v1-8k", display_name: "Kimi 8k", alias: "kimi-8k" },
      { model_name: "moonshot-v1-32k", display_name: "Kimi 32k", alias: "kimi-32k" },
      { model_name: "moonshot-v1-128k", display_name: "Kimi 128k", alias: "kimi-128k" },
    ];
  }
  if (ep.includes("dashscope.aliyuncs.com")) {
    return [
      { model_name: "qwen-max", display_name: "Qwen Max", alias: "qwen-max" },
      { model_name: "qwen-plus", display_name: "Qwen Plus", alias: "qwen-plus" },
      { model_name: "qwen-turbo", display_name: "Qwen Turbo", alias: "qwen-turbo" },
    ];
  }

  if (type === "anthropic") {
    return [
      {
        model_name: "claude-3-7-sonnet-20250219",
        display_name: "Claude 3.7 Sonnet",
        alias: "claude-3-7-sonnet",
      },
      {
        model_name: "claude-3-5-sonnet-20241022",
        display_name: "Claude 3.5 Sonnet",
        alias: "claude-3-5-sonnet",
      },
      {
        model_name: "claude-3-5-haiku-20241022",
        display_name: "Claude 3.5 Haiku",
        alias: "claude-3-5-haiku",
      },
    ];
  }

  if (type === "gemini") {
    return [
      { model_name: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", alias: "gemini-pro" },
      { model_name: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash", alias: "gemini-flash" },
      { model_name: "gemini-2.0-flash", display_name: "Gemini 2.0 Flash", alias: "gemini-2.0-flash" },
    ];
  }

  return [
    { model_name: "gpt-4o", display_name: "GPT-4o", alias: "gpt-4o" },
    { model_name: "gpt-4o-mini", display_name: "GPT-4o Mini", alias: "gpt-4o-mini" },
    { model_name: "o1", display_name: "OpenAI o1", alias: "o1" },
    { model_name: "o3-mini", display_name: "OpenAI o3 Mini", alias: "o3-mini" },
  ];
}

/**
 * Extracts models array from various JSON formats / settings config.
 */
function extractModelsFromConfig(cfg: any, meta?: any): ParsedCcSwitchModel[] {
  const modelsMap = new Map<string, ParsedCcSwitchModel>();

  function addModel(raw: any) {
    if (!raw) return;
    if (typeof raw === "string") {
      const name = raw.trim();
      if (name && !modelsMap.has(name)) {
        modelsMap.set(name, { model_name: name, display_name: name });
      }
    } else if (typeof raw === "object") {
      const name = (raw.model_name || raw.id || raw.name || raw.model || "").trim();
      if (name && !modelsMap.has(name)) {
        modelsMap.set(name, {
          model_name: name,
          display_name: raw.display_name || raw.displayName || raw.name || name,
          alias: raw.alias || null,
          input_price_per_m: typeof raw.input_price_per_m === "number" ? raw.input_price_per_m : undefined,
          output_price_per_m: typeof raw.output_price_per_m === "number" ? raw.output_price_per_m : undefined,
        });
      }
    }
  }

  if (cfg) {
    if (Array.isArray(cfg.models)) cfg.models.forEach(addModel);
    if (Array.isArray(cfg.modelList)) cfg.modelList.forEach(addModel);
    if (Array.isArray(cfg.model_list)) cfg.model_list.forEach(addModel);
    if (Array.isArray(cfg.customModels)) cfg.customModels.forEach(addModel);
    if (Array.isArray(cfg.custom_models)) cfg.custom_models.forEach(addModel);
    if (Array.isArray(cfg.modelCatalog)) cfg.modelCatalog.forEach(addModel);
    if (typeof cfg.model === "string") addModel(cfg.model);
    if (typeof cfg.selectedModel === "string") addModel(cfg.selectedModel);
    if (typeof cfg.ANTHROPIC_MODEL === "string") addModel(cfg.ANTHROPIC_MODEL);
  }

  if (meta) {
    if (Array.isArray(meta.models)) meta.models.forEach(addModel);
    if (Array.isArray(meta.modelList)) meta.modelList.forEach(addModel);
    if (typeof meta.model === "string") addModel(meta.model);
  }

  return Array.from(modelsMap.values());
}

/**
 * Parses SQL dump exports from CC-Switch database.
 */
export function parseCcSwitchSql(sql: string): ParsedCcSwitchProvider[] {
  const providers: ParsedCcSwitchProvider[] = [];

  // Match SQL INSERT INTO providers (...) VALUES (...);
  const insertRegex = /INSERT\s+INTO\s+providers\s*(?:\([^)]+\))?\s*VALUES\s*([\s\S]*?);/gi;
  let match: RegExpExecArray | null;

  while ((match = insertRegex.exec(sql)) !== null) {
    const valuesBlock = match[1];
    const rows = splitSqlValues(valuesBlock);

    for (const row of rows) {
      if (row.length < 4) continue;
      // Standard columns: id (0), app_type (1), name (2), settings_config (3), meta (4)
      const appType = row[1]?.trim();
      const name = row[2]?.trim() || "Imported Provider";
      const settingsConfigRaw = row[3]?.trim();
      const metaRaw = row[4]?.trim();

      let cfg: Record<string, any> = {};
      try {
        if (settingsConfigRaw) cfg = JSON.parse(settingsConfigRaw);
      } catch {}

      let meta: Record<string, any> = {};
      try {
        if (metaRaw) meta = JSON.parse(metaRaw);
      } catch {}

      const apiKey = cfg.apiKey || cfg.api_key || cfg.key || cfg.token || cfg.ANTHROPIC_API_KEY || cfg.OPENAI_API_KEY || null;
      const endpoint =
        cfg.apiBaseUrl ||
        cfg.api_base_url ||
        cfg.baseUrl ||
        cfg.base_url ||
        cfg.endpoint ||
        cfg.url ||
        cfg.ANTHROPIC_BASE_URL ||
        cfg.OPENAI_BASE_URL ||
        null;

      const type = inferProviderType(appType, endpoint, cfg.type || meta.providerType);
      let models = extractModelsFromConfig(cfg, meta);
      if (!models.length) {
        models = getDefaultModelsForProvider(type, endpoint);
      }

      providers.push({
        name,
        type,
        endpoint,
        api_key: apiKey,
        enabled: true,
        models,
        raw_config: { ...cfg, meta },
      });
    }
  }

  return providers;
}

/**
 * Splits SQL VALUES comma-separated rows accounting for quotes and escaped characters.
 */
function splitSqlValues(block: string): string[][] {
  const result: string[][] = [];
  let inString = false;
  let quoteChar = "";
  let inRow = false;
  let currentField = "";
  let currentRow: string[] = [];

  for (let i = 0; i < block.length; i++) {
    const char = block[i];
    const prevChar = i > 0 ? block[i - 1] : "";

    if (!inString && char === "(") {
      inRow = true;
      currentRow = [];
      currentField = "";
      continue;
    }

    if (inRow && !inString && char === ")") {
      currentRow.push(currentField.trim());
      result.push(currentRow);
      inRow = false;
      currentRow = [];
      currentField = "";
      continue;
    }

    if (inRow) {
      if ((char === "'" || char === '"') && prevChar !== "\\") {
        if (inString && char === quoteChar) {
          // Check for escaped double quote like '' in SQL
          if (i + 1 < block.length && block[i + 1] === quoteChar) {
            currentField += quoteChar;
            i++;
            continue;
          }
          inString = false;
        } else if (!inString) {
          inString = true;
          quoteChar = char;
        } else {
          currentField += char;
        }
        continue;
      }

      if (!inString && char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
        continue;
      }

      currentField += char;
    }
  }

  return result;
}

/**
 * Parses deep link ccswitch:// or cc-switch://
 */
export function parseCcSwitchUrl(urlStr: string): ParsedCcSwitchProvider[] {
  const trimmed = urlStr.trim();
  if (!trimmed.startsWith("ccswitch://") && !trimmed.startsWith("cc-switch://")) {
    return [];
  }

  try {
    const dummyUrl = trimmed.replace(/^cc-?switch:\/\//i, "http://ccswitch.local/");
    const parsed = new URL(dummyUrl);
    const params = parsed.searchParams;

    const name = params.get("name") || params.get("provider") || "CC Switch Provider";
    const appType = params.get("app") || params.get("app_type") || params.get("type");
    const apiKey = params.get("apiKey") || params.get("api_key") || params.get("key") || params.get("token");
    const endpoint =
      params.get("endpoint") ||
      params.get("baseUrl") ||
      params.get("base_url") ||
      params.get("apiBaseUrl") ||
      params.get("url");
    const modelsParam = params.get("models") || params.get("modelList") || params.get("model");

    const type = inferProviderType(appType, endpoint);
    let models: ParsedCcSwitchModel[] = [];

    if (modelsParam) {
      try {
        const parsedModels = JSON.parse(modelsParam);
        if (Array.isArray(parsedModels)) {
          models = parsedModels.map((m) =>
            typeof m === "string" ? { model_name: m, display_name: m } : m
          );
        }
      } catch {
        models = modelsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((m) => ({ model_name: m, display_name: m }));
      }
    }

    if (!models.length) {
      models = getDefaultModelsForProvider(type, endpoint);
    }

    return [
      {
        name,
        type,
        endpoint,
        api_key: apiKey,
        enabled: true,
        models,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Parses JSON object/array from CC-Switch export or settings.json.
 */
export function parseCcSwitchJson(jsonStr: string): ParsedCcSwitchProvider[] {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];

  const providers: ParsedCcSwitchProvider[] = [];

  function processSingleProvider(obj: any): ParsedCcSwitchProvider | null {
    if (!obj || typeof obj !== "object") return null;

    const cfg = obj.settings_config || obj.config || obj;
    const meta = obj.meta || {};

    const name = obj.name || cfg.name || "Imported Provider";
    const appType = obj.app_type || obj.appType || obj.app || meta.app_type;
    const apiKey =
      cfg.apiKey ||
      cfg.api_key ||
      cfg.key ||
      cfg.token ||
      cfg.ANTHROPIC_API_KEY ||
      cfg.OPENAI_API_KEY ||
      cfg.GEMINI_API_KEY ||
      obj.api_key ||
      obj.apiKey ||
      null;

    const endpoint =
      cfg.apiBaseUrl ||
      cfg.api_base_url ||
      cfg.baseUrl ||
      cfg.base_url ||
      cfg.endpoint ||
      cfg.url ||
      cfg.ANTHROPIC_BASE_URL ||
      cfg.OPENAI_BASE_URL ||
      obj.endpoint ||
      obj.baseUrl ||
      null;

    const type = inferProviderType(appType, endpoint, obj.type || cfg.type || meta.providerType);
    let models = extractModelsFromConfig(cfg, meta);
    if (!models.length && Array.isArray(obj.models)) {
      models = extractModelsFromConfig(obj, meta);
    }
    if (!models.length) {
      models = getDefaultModelsForProvider(type, endpoint);
    }

    return {
      name,
      type,
      endpoint,
      api_key: apiKey,
      enabled: obj.enabled !== false,
      models,
      raw_config: obj,
    };
  }

  // 1. Array of providers
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const p = processSingleProvider(item);
      if (p) providers.push(p);
    }
    return providers;
  }

  // 2. Object with { providers: [...] }
  if (Array.isArray(parsed.providers)) {
    for (const item of parsed.providers) {
      const p = processSingleProvider(item);
      if (p) providers.push(p);
    }
    return providers;
  }

  // 3. Object with { env: { ... } } (Claude Code settings.json)
  if (parsed.env && typeof parsed.env === "object") {
    const env = parsed.env;
    const p = processSingleProvider({
      name: "Claude Code Env",
      app_type: "claude",
      settings_config: env,
    });
    if (p) providers.push(p);
    return providers;
  }

  // 4. Single provider object
  const single = processSingleProvider(parsed);
  if (single && (single.api_key || single.endpoint || single.name !== "Imported Provider")) {
    providers.push(single);
  }

  return providers;
}

/**
 * Parses raw .env string format (e.g. ANTHROPIC_API_KEY=..., ANTHROPIC_BASE_URL=...)
 */
export function parseCcSwitchEnv(text: string): ParsedCcSwitchProvider[] {
  const lines = text.split("\n");
  const env: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }

  if (Object.keys(env).length === 0) return [];

  const providers: ParsedCcSwitchProvider[] = [];

  // Anthropic env
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL) {
    const ep = env.ANTHROPIC_BASE_URL || null;
    const type = "anthropic";
    const models = getDefaultModelsForProvider(type, ep);
    if (env.ANTHROPIC_MODEL) {
      models.unshift({ model_name: env.ANTHROPIC_MODEL, display_name: env.ANTHROPIC_MODEL });
    }
    providers.push({
      name: "Anthropic Provider",
      type,
      endpoint: ep,
      api_key: env.ANTHROPIC_API_KEY || null,
      enabled: true,
      models,
    });
  }

  // OpenAI env
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) {
    const ep = env.OPENAI_BASE_URL || null;
    const type = "openai";
    const models = getDefaultModelsForProvider(type, ep);
    if (env.OPENAI_MODEL) {
      models.unshift({ model_name: env.OPENAI_MODEL, display_name: env.OPENAI_MODEL });
    }
    providers.push({
      name: "OpenAI Provider",
      type,
      endpoint: ep,
      api_key: env.OPENAI_API_KEY || null,
      enabled: true,
      models,
    });
  }

  // Gemini env
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
    const ep = env.GEMINI_BASE_URL || null;
    const type = "gemini";
    providers.push({
      name: "Gemini Provider",
      type,
      endpoint: ep,
      api_key: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null,
      enabled: true,
      models: getDefaultModelsForProvider(type, ep),
    });
  }

  return providers;
}

/**
 * Universal dispatcher to parse CC-Switch configurations in any supported format.
 */
export function parseCcSwitchConfig(rawText: string): ParsedCcSwitchProvider[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. Check for CC Switch protocol URL
  if (trimmed.startsWith("ccswitch://") || trimmed.startsWith("cc-switch://")) {
    const res = parseCcSwitchUrl(trimmed);
    if (res.length) return res;
  }

  // 2. Check for SQL Dump
  if (
    trimmed.toUpperCase().includes("INSERT INTO") ||
    trimmed.toUpperCase().includes("CREATE TABLE")
  ) {
    const res = parseCcSwitchSql(trimmed);
    if (res.length) return res;
  }

  // 3. Check for JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const res = parseCcSwitchJson(trimmed);
    if (res.length) return res;
  }

  // 4. Check for .env format
  const res = parseCcSwitchEnv(trimmed);
  if (res.length) return res;

  return [];
}
