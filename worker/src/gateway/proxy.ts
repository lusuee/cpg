import type { Context } from "hono";
import type { Env, ModelWithProvider, ProviderType, TokenUsage } from "../types";
import { authenticateGateway } from "./auth";
import { findModelAndProvider, recordUsageSafe, randomRequestId } from "../db/repo";
import { parseUsage } from "./usage";
import { buildUpstreamHeaders, cleanResponseHeaders } from "../utils/http";
import {
  convertResponsesRequest,
  convertChatToResponsesJson,
  createChatToResponsesTransform,
} from "./responses_adapter";

const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
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
  device: { id: string };
  row: ModelWithProvider;
  upstreamStatus: number;
  latencyMs: number;
  requestId: string;
  createdAt: number;
}

function buildTargetUrl(row: ModelWithProvider, kind: "messages" | "chat/completions" | "responses"): string {
  const base = (row.provider_endpoint || DEFAULT_ENDPOINTS[row.provider_type]).replace(/\/+$/, "");
  const suffix = kind === "messages" ? "/messages" : kind === "responses" ? "/responses" : "/chat/completions";
  return base + suffix;
}

async function record(
  ctx: ProxyContext,
  usage: TokenUsage | null,
  statusCode: number
) {
  await recordUsageSafe(ctx.c.env, {
    device_id: ctx.device.id,
    provider_id: ctx.row.provider_id,
    provider_name: ctx.row.provider_name,
    model: ctx.row.model_name,
    usage,
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
  let tail = "";
  let resolveDone: () => void = () => {};
  const donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
  const decoder = new TextDecoder();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      tail += decoder.decode(chunk, { stream: true });
      if (tail.length > MAX_TAIL) tail = tail.slice(-MAX_TAIL);
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
      const usage = parseUsage(ctx.row.provider_type, tail);
      await record(ctx, usage, upstreamRes.status);
    })
  );
  return res;
}

export async function handleGatewayProxy(c: Context<{ Bindings: Env }>, kind: "messages" | "chat/completions" | "responses") {
  const device = await authenticateGateway(c);
  if (!device) return c.json({ error: "unauthorized" }, 401);

  const rawBody = await c.req.text();
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const modelKey = body?.model;
  if (typeof modelKey !== "string" || !modelKey) return c.json({ error: "missing_model" }, 400);

  const row = await findModelAndProvider(c.env, modelKey);
  if (!row) return c.json({ error: "model_not_found", model: modelKey }, 404);

  if (kind === "messages" && row.provider_type !== "anthropic") {
    return c.json({ error: "unsupported_provider_for_path", message: "/v1/messages requires an anthropic provider" }, 400);
  }
  if ((kind === "chat/completions" || kind === "responses") && row.provider_type !== "openai") {
    return c.json({ error: "unsupported_provider_for_path", message: `/${kind} requires an openai provider` }, 400);
  }

  const secretName = row.provider_secret_name;
  if (!secretName) return c.json({ error: "provider_secret_not_configured" }, 502);
  const upstreamKey = (c.env as Record<string, unknown>)[secretName];
  if (typeof upstreamKey !== "string" || !upstreamKey) {
    return c.json({ error: "provider_secret_not_configured", message: `Secret ${secretName} is not set` }, 502);
  }

  if (body.model !== row.model_name) body.model = row.model_name;
  const isStream = body.stream === true;
  const requestId = randomRequestId();
  const startedAt = Date.now();

  const headers = buildUpstreamHeaders(c.req.raw.headers, row.provider_type, upstreamKey);

  // For responses kind: if upstream is an OpenAI provider, attempt /responses first.
  // If upstream returns 404/405 (e.g. DeepSeek/OneAPI which only have /chat/completions),
  // automatically adapt and proxy through /chat/completions.
  if (kind === "responses") {
    let target = buildTargetUrl(row, "responses");
    let reqBody = body;
    let upstreamRes = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      redirect: "follow",
    });

    // If upstream /responses returns any error (e.g. 404, 405, 422 schema mismatch, 501, 400),
    // automatically fallback to standard /chat/completions and adapt the protocol stream/json.
    if (!upstreamRes.ok) {
      target = buildTargetUrl(row, "chat/completions");
      const chatBody = convertResponsesRequest(body);
      upstreamRes = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(chatBody),
        redirect: "follow",
      });

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
      };

      if (upstreamRes.ok) {
        if (isStream && upstreamRes.body) {
          let fullOutput = "";
          const transform = createChatToResponsesTransform(requestId, row.model_name, (text) => {
            fullOutput = text;
          });
          const readable = upstreamRes.body.pipeThrough(transform);
          const outHeaders = cleanResponseHeaders(upstreamRes.headers);
          outHeaders.set("content-type", "text/event-stream; charset=utf-8");
          outHeaders.set("cache-control", "no-cache");

          waitUntil(
            c,
            record(pctx, { input_tokens: 0, output_tokens: Math.ceil(fullOutput.length / 4), total_tokens: Math.ceil(fullOutput.length / 4) }, upstreamRes.status)
          );

          return new Response(readable, { status: 200, headers: outHeaders });
        } else {
          const chatJson: any = await upstreamRes.json();
          pctx.latencyMs = Date.now() - startedAt;
          const responsesJson = convertChatToResponsesJson(chatJson, requestId);
          const usage = chatJson.usage || null;
          waitUntil(c, record(pctx, usage, upstreamRes.status));
          return c.json(responsesJson, 200);
        }
      }
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
    };

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
  const upstreamRes = await fetch(target, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "follow",
  });

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
  };

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

export async function listModelsHandler(c: Context<{ Bindings: Env }>) {
  const device = await authenticateGateway(c);
  if (!device) return c.json({ error: "unauthorized" }, 401);
  const res = await c.env.DB.prepare(
    "SELECT m.id, m.model_name, m.display_name, m.alias, m.created_at, p.name as owned_by " +
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
  }));
  return c.json({ object: "list", data });
}
