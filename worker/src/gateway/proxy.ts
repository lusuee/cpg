import type { Context } from "hono";
import type { DeviceRow, Env, ModelWithProvider, ProviderType, TokenUsage } from "../types";
import { authenticateGateway } from "./auth";
import {
  findModelAndProvider,
  getModelWithProviderById,
  checkDeviceRateLimit,
  recordUsageSafe,
  randomRequestId,
} from "../db/repo";
import { parseUsage } from "./usage";
import { buildUpstreamHeaders, cleanResponseHeaders } from "../utils/http";
import {
  convertResponsesRequest,
  convertChatToResponsesJson,
  createChatToResponsesTransform,
} from "./responses_adapter";
import {
  computeCacheKey,
  shouldBypassCache,
  getCachedEntry,
  setCachedEntry,
  createCachedResponse,
} from "./cache";

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

function waitUntil(c: Context<{ Bindings: Env }>, p: Promise<void>) {
  const ctx = (c as any).executionCtx as ExecutionContext | undefined;
  if (ctx?.waitUntil) ctx.waitUntil(p);
  else void p;
}

interface ProxyContext {
  c: Context<{ Bindings: Env }>;
  kind: "messages" | "chat/completions" | "responses";
  startedAt: number;
  device: DeviceRow;
  row: ModelWithProvider;
  upstreamStatus: number;
  latencyMs: number;
  requestId: string;
  createdAt: number;
  cacheKey?: string;
}

function buildTargetUrl(row: ModelWithProvider, kind: "messages" | "chat/completions" | "responses"): string {
  const base = (row.provider_endpoint || DEFAULT_ENDPOINTS[row.provider_type] || DEFAULT_ENDPOINTS.openai).replace(/\/+$/, "");
  const suffix = kind === "messages" ? "/messages" : kind === "responses" ? "/responses" : "/chat/completions";
  return base + suffix;
}

async function record(
  ctx: ProxyContext,
  usage: TokenUsage | null,
  statusCode: number
) {
  const inTokens = usage?.input_tokens ?? 0;
  const outTokens = usage?.output_tokens ?? 0;
  const inPrice = ctx.row.input_price_per_m || 0;
  const outPrice = ctx.row.output_price_per_m || 0;
  const costUsd = inPrice > 0 || outPrice > 0 ? (inTokens * inPrice + outTokens * outPrice) / 1_000_000 : 0;

  await recordUsageSafe(ctx.c.env, {
    device_id: ctx.device.id,
    provider_id: ctx.row.provider_id,
    provider_name: ctx.row.provider_name,
    model: ctx.row.model_name,
    usage,
    cost_usd: costUsd,
    cache_hit: 0,
    status_code: statusCode,
    latency_ms: ctx.latencyMs,
    request_id: ctx.requestId,
    created_at: ctx.createdAt,
  });
}

function passthroughStream(ctx: ProxyContext, upstreamRes: Response): Response {
  if (!upstreamRes.body) {
    const res = new Response(null, { status: upstreamRes.status, headers: cleanResponseHeaders(upstreamRes.headers) });
    waitUntil(ctx.c, record(ctx, null, upstreamRes.status));
    return res;
  }

  const MAX_TAIL = 16 * 1024;
  let fullStreamText = "";
  let resolveDone: () => void = () => {};
  const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
  const decoder = new TextDecoder();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const decoded = decoder.decode(chunk, { stream: true });
      fullStreamText += decoded;
      controller.enqueue(chunk);
    },
    flush() {
      resolveDone();
    },
  });

  const readable = upstreamRes.body.pipeThrough(transform);
  const headers = cleanResponseHeaders(upstreamRes.headers);
  const res = new Response(readable, { status: upstreamRes.status, headers });

  waitUntil(
    ctx.c,
    donePromise.then(async () => {
      const usage = parseUsage(ctx.row.provider_type, fullStreamText);
      await record(ctx, usage, upstreamRes.status);

      // Asynchronously cache on 200 OK if cache is enabled
      if (upstreamRes.ok && ctx.row.cache_enabled && ctx.cacheKey) {
        try {
          if (ctx.kind === "chat/completions") {
            // Extract assistant text from SSE chunks
            let extractedText = "";
            const lines = fullStreamText.split(/\r?\n/);
            for (const line of lines) {
              if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                try {
                  const chunkJson = JSON.parse(line.slice(6));
                  const delta = chunkJson.choices?.[0]?.delta?.content;
                  if (delta) extractedText += delta;
                } catch {}
              }
            }
            const jsonBody = {
              id: `chatcmpl-${ctx.requestId}`,
              object: "chat.completion",
              created: Math.floor(ctx.createdAt / 1000),
              model: ctx.row.model_name,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: extractedText },
                  finish_reason: "stop",
                },
              ],
              usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            };
            await setCachedEntry(
              ctx.c.env,
              ctx.cacheKey,
              {
                kind: ctx.kind,
                model: ctx.row.model_name,
                jsonBody,
                usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                createdAt: ctx.createdAt,
              },
              ctx.row.cache_ttl
            );
          } else if (ctx.kind === "messages") {
            let extractedText = "";
            const lines = fullStreamText.split(/\r?\n/);
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const eventJson = JSON.parse(line.slice(6));
                  if (eventJson.type === "content_block_delta" && eventJson.delta?.text) {
                    extractedText += eventJson.delta.text;
                  }
                } catch {}
              }
            }
            const jsonBody = {
              id: `msg_${ctx.requestId}`,
              type: "message",
              role: "assistant",
              model: ctx.row.model_name,
              content: [{ type: "text", text: extractedText }],
              stop_reason: "end_turn",
              usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
            };
            await setCachedEntry(
              ctx.c.env,
              ctx.cacheKey,
              {
                kind: ctx.kind,
                model: ctx.row.model_name,
                jsonBody,
                usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
                createdAt: ctx.createdAt,
              },
              ctx.row.cache_ttl
            );
          }
        } catch {}
      }
    })
  );
  return res;
}

async function executeProxyAttempt(
  c: Context<{ Bindings: Env }>,
  kind: "messages" | "chat/completions" | "responses",
  device: DeviceRow,
  row: ModelWithProvider,
  body: any,
  requestId: string,
  cacheKey?: string
): Promise<Response | null> {
  const secretName = row.provider_secret_name;
  if (!secretName) return null;
  const upstreamKey = (c.env as Record<string, unknown>)[secretName];
  if (typeof upstreamKey !== "string" || !upstreamKey) return null;

  const reqBody = { ...body, model: row.model_name };
  const isStream = reqBody.stream === true;
  const startedAt = Date.now();
  const headers = buildUpstreamHeaders(c.req.raw.headers, row.provider_type, upstreamKey);

  if (kind === "responses") {
    const target = buildTargetUrl(row, "chat/completions");
    const chatBody = convertResponsesRequest(reqBody);
    headers.set("Content-Type", "application/json");

    const approxInputTokens = Math.max(1, Math.ceil(JSON.stringify(chatBody.messages).length / 4));

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(chatBody),
        redirect: "follow",
      });
    } catch {
      return null;
    }

    if (!upstreamRes.ok && upstreamRes.status >= 500) {
      return null;
    }

    const pctx: ProxyContext = {
      c,
      kind,
      startedAt,
      device,
      row,
      upstreamStatus: upstreamRes.status,
      latencyMs: Date.now() - startedAt,
      requestId,
      createdAt: startedAt,
      cacheKey,
    };

    if (upstreamRes.ok) {
      if (isStream && upstreamRes.body) {
        let resolveDone: () => void = () => {};
        const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
        let fullOutput = "";

        const transform = createChatToResponsesTransform(requestId, row.model_name, (text) => {
          fullOutput = text;
          resolveDone();
        });

        const readable = upstreamRes.body.pipeThrough(transform);
        const outHeaders = cleanResponseHeaders(upstreamRes.headers);
        outHeaders.set("content-type", "text/event-stream; charset=utf-8");
        outHeaders.set("cache-control", "no-cache");

        waitUntil(
          c,
          donePromise.then(async () => {
            pctx.latencyMs = Date.now() - startedAt;
            const approxOutputTokens = Math.max(1, Math.ceil(fullOutput.length / 4));
            const usageObj = {
              input_tokens: approxInputTokens,
              output_tokens: approxOutputTokens,
              total_tokens: approxInputTokens + approxOutputTokens,
            };
            await record(pctx, usageObj, upstreamRes.status);

            if (row.cache_enabled && cacheKey) {
              const respJson = {
                id: `resp_${requestId}`,
                object: "response",
                status: "completed",
                model: row.model_name,
                output: [
                  {
                    id: `item_${requestId}`,
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "text", text: fullOutput }],
                  },
                ],
                usage: usageObj,
              };
              await setCachedEntry(
                c.env,
                cacheKey,
                {
                  kind,
                  model: row.model_name,
                  jsonBody: respJson,
                  usage: usageObj,
                  createdAt: startedAt,
                },
                row.cache_ttl
              );
            }
          })
        );

        return new Response(readable, { status: 200, headers: outHeaders });
      } else {
        const chatJson: any = await upstreamRes.json();
        pctx.latencyMs = Date.now() - startedAt;
        const responsesJson = convertChatToResponsesJson(chatJson, requestId);
        const usage = chatJson.usage || {
          input_tokens: approxInputTokens,
          output_tokens: Math.max(1, Math.ceil((responsesJson.output?.[0]?.content?.[0]?.text || "").length / 4)),
          total_tokens: approxInputTokens + Math.max(1, Math.ceil((responsesJson.output?.[0]?.content?.[0]?.text || "").length / 4)),
        };
        waitUntil(
          c,
          record(pctx, usage, upstreamRes.status).then(async () => {
            if (row.cache_enabled && cacheKey) {
              await setCachedEntry(
                c.env,
                cacheKey,
                {
                  kind,
                  model: row.model_name,
                  jsonBody: responsesJson,
                  usage,
                  createdAt: startedAt,
                },
                row.cache_ttl
              );
            }
          })
        );
        return c.json(responsesJson, 200);
      }
    }

    if (isStream) return passthroughStream(pctx, upstreamRes);

    const text = await upstreamRes.text();
    pctx.latencyMs = Date.now() - startedAt;
    const usage = parseUsage(row.provider_type, text);
    const res = new Response(text, {
      status: upstreamRes.status,
      headers: cleanResponseHeaders(upstreamRes.headers),
    });
    waitUntil(pctx.c, record(pctx, usage, upstreamRes.status));
    return res;
  }

  const target = buildTargetUrl(row, kind);
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      redirect: "follow",
    });
  } catch {
    return null;
  }

  if (!upstreamRes.ok && (upstreamRes.status >= 500 || upstreamRes.status === 429)) {
    return null;
  }

  const pctx: ProxyContext = {
    c,
    kind,
    startedAt,
    device,
    row,
    upstreamStatus: upstreamRes.status,
    latencyMs: Date.now() - startedAt,
    requestId,
    createdAt: startedAt,
    cacheKey,
  };

  if (isStream) return passthroughStream(pctx, upstreamRes);

  const text = await upstreamRes.text();
  pctx.latencyMs = Date.now() - startedAt;
  const usage = parseUsage(row.provider_type, text);
  const res = new Response(text, {
    status: upstreamRes.status,
    headers: cleanResponseHeaders(upstreamRes.headers),
  });

  waitUntil(
    pctx.c,
    record(pctx, usage, upstreamRes.status).then(async () => {
      if (upstreamRes.ok && row.cache_enabled && cacheKey) {
        try {
          const jsonBody = JSON.parse(text);
          await setCachedEntry(
            c.env,
            cacheKey,
            {
              kind,
              model: row.model_name,
              jsonBody,
              usage: usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
              createdAt: startedAt,
            },
            row.cache_ttl
          );
        } catch {}
      }
    })
  );
  return res;
}

export async function handleGatewayProxy(c: Context<{ Bindings: Env }>, kind: "messages" | "chat/completions" | "responses") {
  const device = await authenticateGateway(c);
  if (!device) return c.json({ error: "unauthorized" }, 401);

  if (device.rate_limit_rpm && device.rate_limit_rpm > 0) {
    const allowed = await checkDeviceRateLimit(c.env, device.id, device.rate_limit_rpm);
    if (!allowed) {
      c.header("Retry-After", "60");
      return c.json(
        { error: "rate_limit_exceeded", message: `Device rate limit of ${device.rate_limit_rpm} RPM exceeded` },
        429
      );
    }
  }

  const rawBody = await c.req.text();
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const modelKey = body?.model;
  if (typeof modelKey !== "string" || !modelKey) return c.json({ error: "missing_model" }, 400);

  let row = await findModelAndProvider(c.env, modelKey);
  if (!row) return c.json({ error: "model_not_found", model: modelKey }, 404);

  if (kind === "messages" && row.provider_type !== "anthropic") {
    return c.json({ error: "unsupported_provider_for_path", message: "/v1/messages requires an anthropic provider" }, 400);
  }
  if ((kind === "chat/completions" || kind === "responses") && row.provider_type === "anthropic") {
    return c.json({ error: "unsupported_provider_for_path", message: `/${kind} requires an openai or gemini provider` }, 400);
  }

  const requestId = randomRequestId();
  const isStream = body?.stream === true;
  const bypass = shouldBypassCache(c.req.raw.headers, body);
  const cacheEnabled = Boolean(row.cache_enabled);

  let cacheKey: string | undefined;
  if (cacheEnabled) {
    cacheKey = await computeCacheKey(kind, row.model_name, body);

    if (!bypass) {
      const cached = await getCachedEntry(c.env, cacheKey);
      if (cached) {
        const cacheStartedAt = Date.now();
        const cachedRes = createCachedResponse(cached, kind, isStream, row.model_name, requestId);
        waitUntil(
          c,
          recordUsageSafe(c.env, {
            device_id: device.id,
            provider_id: row.provider_id,
            provider_name: row.provider_name,
            model: row.model_name,
            usage: cached.usage,
            cost_usd: 0,
            cache_hit: 1,
            status_code: 200,
            latency_ms: Date.now() - cacheStartedAt,
            request_id: requestId,
            created_at: cacheStartedAt,
          })
        );
        return cachedRes;
      }
    }
  }

  // Primary attempt
  let response = await executeProxyAttempt(c, kind, device, row, body, requestId, cacheKey);

  // If primary attempt failed and fallback_model_id is configured, attempt fallback
  if (!response && row.fallback_model_id) {
    const fallbackRow = await getModelWithProviderById(c.env, row.fallback_model_id);
    if (fallbackRow) {
      const fallbackCacheKey = fallbackRow.cache_enabled
        ? await computeCacheKey(kind, fallbackRow.model_name, body)
        : undefined;
      response = await executeProxyAttempt(c, kind, device, fallbackRow, body, requestId, fallbackCacheKey);
    }
  }

  if (!response) {
    return c.json({ error: "upstream_service_unavailable", message: "Failed to fetch response from primary and fallback upstream" }, 502);
  }

  return response;
}

export async function listModelsHandler(c: Context<{ Bindings: Env }>) {
  const device = await authenticateGateway(c);
  if (!device) return c.json({ error: "unauthorized" }, 401);
  const res = await c.env.DB.prepare(
    "SELECT m.id, m.model_name, m.display_name, m.alias, m.fallback_model_id, m.input_price_per_m, m.output_price_per_m, m.created_at, p.name as owned_by " +
      "FROM models m JOIN providers p ON p.id = m.provider_id " +
      "WHERE m.enabled = 1 AND p.enabled = 1 ORDER BY p.name, m.model_name"
  ).all();
  const data = (res.results || []).map((r: any) => ({
    id: r.model_name || r.id,
    object: "model",
    created: r.created_at ? Math.floor(r.created_at / 1000) : 0,
    owned_by: r.owned_by || "",
    display_name: r.display_name || null,
    alias: r.alias || null,
    fallback_model_id: r.fallback_model_id || null,
    input_price_per_m: r.input_price_per_m || 0,
    output_price_per_m: r.output_price_per_m || 0,
  }));
  return c.json({ object: "list", data });
}

