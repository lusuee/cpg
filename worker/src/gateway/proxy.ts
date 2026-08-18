import type { Context } from "hono";
import type { Env, ModelWithProvider, ProviderType, TokenUsage } from "../types";
import { authenticateGateway } from "./auth";
import { findModelAndProvider, recordUsageSafe, randomRequestId } from "../db/repo";
import { parseUsage } from "./usage";
import { buildUpstreamHeaders, cleanResponseHeaders } from "../utils/http";

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
  kind: "messages" | "chat/completions";
  startedAt: number;
  device: { id: string };
  row: ModelWithProvider;
  upstreamStatus: number;
  latencyMs: number;
  requestId: string;
  createdAt: number;
}

function buildTargetUrl(row: ModelWithProvider, kind: "messages" | "chat/completions"): string {
  const base = (row.provider_endpoint || DEFAULT_ENDPOINTS[row.provider_type]).replace(/\/+$/, "");
  const suffix = kind === "messages" ? "/messages" : "/chat/completions";
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

export async function handleGatewayProxy(c: Context<{ Bindings: Env }>, kind: "messages" | "chat/completions") {
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
  if (kind === "chat/completions" && row.provider_type !== "openai") {
    return c.json({ error: "unsupported_provider_for_path", message: "/v1/chat/completions requires an openai provider" }, 400);
  }

  const secretName = row.provider_secret_name;
  if (!secretName) return c.json({ error: "provider_secret_not_configured" }, 502);
  const upstreamKey = (c.env as Record<string, unknown>)[secretName];
  if (typeof upstreamKey !== "string" || !upstreamKey) {
    return c.json({ error: "provider_secret_not_configured", message: `Secret ${secretName} is not set` }, 502);
  }

  if (body.model !== row.model_name) body.model = row.model_name;
  const isStream = body.stream === true;

  const target = buildTargetUrl(row, kind);
  const headers = buildUpstreamHeaders(c.req.raw.headers, row.provider_type, upstreamKey);
  const startedAt = Date.now();

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
    requestId: randomRequestId(),
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
