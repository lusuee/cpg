export interface RewriteRules {
  system_prompt?: string;
  system_prompt_mode?: "prepend" | "override" | "append";
  temperature?: number;
  temperature_max?: number;
  max_tokens?: number;
  max_tokens_limit?: number;
  top_p?: number;
  model_rewrite?: string;
  routing_strategy?: "priority" | "lowest_latency" | "weighted";
  weight?: number;
  capabilities?: string[];
}

/**
 * Parses rewrite rules from model or provider config_json
 */
export function parseRewriteRules(configJson?: string | null): RewriteRules {
  if (!configJson) return {};
  try {
    const parsed = JSON.parse(configJson);
    return {
      system_prompt: typeof parsed.system_prompt === "string" ? parsed.system_prompt : undefined,
      system_prompt_mode: ["prepend", "override", "append"].includes(parsed.system_prompt_mode) ? parsed.system_prompt_mode : "prepend",
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : undefined,
      temperature_max: typeof parsed.temperature_max === "number" ? parsed.temperature_max : undefined,
      max_tokens: typeof parsed.max_tokens === "number" ? parsed.max_tokens : undefined,
      max_tokens_limit: typeof parsed.max_tokens_limit === "number" ? parsed.max_tokens_limit : undefined,
      top_p: typeof parsed.top_p === "number" ? parsed.top_p : undefined,
      model_rewrite: typeof parsed.model_rewrite === "string" && parsed.model_rewrite.trim() ? parsed.model_rewrite.trim() : undefined,
      routing_strategy: ["priority", "lowest_latency", "weighted"].includes(parsed.routing_strategy) ? parsed.routing_strategy : undefined,
      weight: typeof parsed.weight === "number" ? Math.max(1, parsed.weight) : undefined,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Applies request rewrite rules (system prompt injection, parameter capping/overriding, model renaming)
 */
export function applyRequestRewriteRules(
  reqBody: Record<string, any>,
  rules: RewriteRules,
  kind: "messages" | "chat/completions" | "responses" | "openai" | "anthropic"
): Record<string, any> {
  const body = { ...reqBody };
  const isAnthropic = kind === "messages" || kind === "anthropic";

  // 1. Model Name Rewrite
  if (rules.model_rewrite) {
    body.model = rules.model_rewrite;
  }

  // 2. Temperature override / limit
  if (rules.temperature !== undefined) {
    body.temperature = rules.temperature;
  } else if (rules.temperature_max !== undefined && typeof body.temperature === "number") {
    body.temperature = Math.min(body.temperature, rules.temperature_max);
  }

  // 3. Max Tokens override / limit
  if (rules.max_tokens !== undefined) {
    body.max_tokens = rules.max_tokens;
  } else if (rules.max_tokens_limit !== undefined) {
    if (typeof body.max_tokens === "number") {
      body.max_tokens = Math.min(body.max_tokens, rules.max_tokens_limit);
    } else if (typeof body.max_completion_tokens === "number") {
      body.max_completion_tokens = Math.min(body.max_completion_tokens, rules.max_tokens_limit);
    }
  }

  // 4. Top_P
  if (rules.top_p !== undefined) {
    body.top_p = rules.top_p;
  }

  // 5. System Prompt Injection
  if (rules.system_prompt && rules.system_prompt.trim()) {
    const injectedPrompt = rules.system_prompt.trim();
    const mode = rules.system_prompt_mode || "prepend";

    if (isAnthropic) {
      // Anthropic Protocol (system is top-level string or array)
      const existingSystem = typeof body.system === "string" ? body.system : "";
      if (mode === "override" || !existingSystem) {
        body.system = injectedPrompt;
      } else if (mode === "append") {
        body.system = `${existingSystem}\n\n${injectedPrompt}`;
      } else {
        // prepend
        body.system = `${injectedPrompt}\n\n${existingSystem}`;
      }
    } else {
      // OpenAI Protocol (messages array with role: "system")
      const messages = Array.isArray(body.messages) ? [...body.messages] : [];
      const systemIndex = messages.findIndex((m: any) => m?.role === "system");

      if (systemIndex === -1) {
        // No existing system message -> prepend new one
        messages.unshift({ role: "system", content: injectedPrompt });
      } else {
        const existingContent = typeof messages[systemIndex]?.content === "string" ? messages[systemIndex].content : "";
        if (mode === "override") {
          messages[systemIndex] = { ...messages[systemIndex], content: injectedPrompt };
        } else if (mode === "append") {
          messages[systemIndex] = { ...messages[systemIndex], content: `${existingContent}\n\n${injectedPrompt}` };
        } else {
          // prepend
          messages[systemIndex] = { ...messages[systemIndex], content: `${injectedPrompt}\n\n${existingContent}` };
        }
      }
      body.messages = messages;
    }
  }

  return body;
}
