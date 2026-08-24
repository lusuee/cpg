import { Hono } from "hono";
import type { Env, ModelWithProvider } from "../types";
import { findModelAndProvider, findModelCandidates, recordUsageSafe, randomRequestId } from "../db/repo";
import { buildUpstreamHeaders, cleanResponseHeaders } from "../utils/http";
import { applyRequestRewriteRules } from "../gateway/rewrite";
import { parseUsage } from "../gateway/usage";

export const playgroundApp = new Hono<{ Bindings: Env }>();

const DEFAULT_ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

playgroundApp.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    model: string;
    messages: Array<{ role: string; content: string }>;
    system_prompt?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  };

  if (!body.model || typeof body.model !== "string") {
    return c.json({ error: "model_required", message: "请选择要测试的模型" }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages_required", message: "请输入测试对话内容" }, 400);
  }

  // 1. Resolve Provider & Model
  let row = await findModelAndProvider(c.env, body.model);
  if (!row) {
    const candidates = await findModelCandidates(c.env, body.model);
    if (candidates.length > 0) row = candidates[0];
  }

  if (!row) {
    return c.json({ error: "model_not_found", message: `未找到模型「${body.model}」对应的有效 Provider` }, 404);
  }

  const isStream = Boolean(body.stream);
  const startedAt = Date.now();
  const requestId = randomRequestId();

  // 2. Build Upstream Payload
  let targetUrl: string;
  let reqPayload: any;

  if (row.provider_type === "anthropic") {
    targetUrl = `${row.provider_endpoint || DEFAULT_ENDPOINTS.anthropic}/messages`;
    reqPayload = {
      model: row.model_name,
      messages: body.messages.filter((m) => m.role !== "system"),
      max_tokens: body.max_tokens || 4096,
      stream: isStream,
    };
    if (body.system_prompt || body.messages.find((m) => m.role === "system")) {
      reqPayload.system = body.system_prompt || body.messages.find((m) => m.role === "system")?.content;
    }
    if (typeof body.temperature === "number") reqPayload.temperature = body.temperature;
  } else {
    // OpenAI / Gemini standard chat/completions format
    targetUrl = `${row.provider_endpoint || DEFAULT_ENDPOINTS[row.provider_type] || DEFAULT_ENDPOINTS.openai}/chat/completions`;
    const messages = [...body.messages];
    if (body.system_prompt && !messages.some((m) => m.role === "system")) {
      messages.unshift({ role: "system", content: body.system_prompt });
    }
    reqPayload = {
      model: row.model_name,
      messages,
      stream: isStream,
    };
    if (typeof body.temperature === "number") reqPayload.temperature = body.temperature;
    if (typeof body.max_tokens === "number") reqPayload.max_tokens = body.max_tokens;
  }

  // Apply model rewrite rules if configured
  const { parseRewriteRules } = await import("../gateway/rewrite");
  const rules = parseRewriteRules(row.config_json);
  reqPayload = applyRequestRewriteRules(reqPayload, rules, row.provider_type);

  // 3. Build Headers
  const apiKey = row.provider_api_key || (row.provider_secret_name && (c.env as Record<string, unknown>)[row.provider_secret_name]) || "";
  const headers = buildUpstreamHeaders(c.req.raw.headers, row.provider_type, apiKey as string);

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(reqPayload),
      redirect: "follow",
    });

    const latencyMs = Date.now() - startedAt;

    if (isStream && upstreamRes.ok && upstreamRes.body) {
      const outHeaders = cleanResponseHeaders(upstreamRes.headers);
      outHeaders.set("X-Gateway-Latency-Ms", String(latencyMs));
      outHeaders.set("X-Gateway-Provider", row.provider_name);
      return new Response(upstreamRes.body, { status: 200, headers: outHeaders });
    }

    const respText = await upstreamRes.text();
    let jsonBody: any = null;
    try {
      jsonBody = JSON.parse(respText);
    } catch {}

    const usage = parseUsage(row.provider_type, respText);

    return c.json({
      ok: upstreamRes.ok,
      status: upstreamRes.status,
      latency_ms: latencyMs,
      provider_name: row.provider_name,
      provider_type: row.provider_type,
      target_model: row.model_name,
      usage,
      data: jsonBody || respText,
    });
  } catch (err: any) {
    return c.json(
      {
        ok: false,
        error: "upstream_fetch_error",
        message: err.message || "请求上游服务商失败",
        latency_ms: Date.now() - startedAt,
      },
      502
    );
  }
});
