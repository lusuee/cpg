import type { Env, ModelWithProvider, TokenUsage } from "../types";

export interface CachePayload {
  kind: "messages" | "chat/completions" | "responses";
  model: string;
  jsonBody: any;
  usage: TokenUsage;
  finishReason?: string;
  createdAt: number;
}

// In-memory fallback cache for environments/tests without KV binding
const memoryCache = new Map<string, { payload: CachePayload; expiresAt: number }>();

function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sortedKeys = Object.keys(obj).sort();
  const res: Record<string, any> = {};
  for (const key of sortedKeys) {
    res[key] = sortObjectKeys(obj[key]);
  }
  return res;
}

export async function computeCacheKey(
  kind: "messages" | "chat/completions" | "responses",
  modelName: string,
  body: any
): Promise<string> {
  const normalized: Record<string, any> = {
    kind,
    model: modelName,
    messages: body.messages,
    system: body.system,
    prompt: body.prompt,
    contents: body.contents,
    temperature: typeof body.temperature === "number" ? body.temperature : 1.0,
    top_p: typeof body.top_p === "number" ? body.top_p : 1.0,
    max_tokens: body.max_tokens || body.max_output_tokens,
    tools: body.tools,
    tool_choice: body.tool_choice,
    response_format: body.response_format,
    stop: body.stop || body.stop_sequences,
  };

  const canonicalJson = JSON.stringify(sortObjectKeys(normalized));
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalJson);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `aigw:cache:${kind}:${modelName}:${hashHex}`;
}

export function shouldBypassCache(headers: Headers, body: any): boolean {
  if (headers.get("x-cache-bypass") === "true") return true;
  const cc = headers.get("cache-control") || "";
  if (cc.includes("no-cache") || cc.includes("no-store")) return true;
  return false;
}

export async function getCachedEntry(env: Env, key: string): Promise<CachePayload | null> {
  if (env.CACHE_KV) {
    try {
      const val = await env.CACHE_KV.get(key, "json");
      if (val) return val as CachePayload;
    } catch {
      // KV read failure fallback to memory
    }
  }

  const mem = memoryCache.get(key);
  if (mem) {
    if (Date.now() < mem.expiresAt) return mem.payload;
    memoryCache.delete(key);
  }
  return null;
}

export async function setCachedEntry(
  env: Env,
  key: string,
  payload: CachePayload,
  ttlSeconds: number
): Promise<void> {
  const validTtl = Math.max(60, ttlSeconds || 3600);
  if (env.CACHE_KV) {
    try {
      await env.CACHE_KV.put(key, JSON.stringify(payload), { expirationTtl: validTtl });
    } catch {
      // Ignore KV write failure
    }
  }

  memoryCache.set(key, {
    payload,
    expiresAt: Date.now() + validTtl * 1000,
  });
}

export function clearMemoryCacheForTest(): void {
  memoryCache.clear();
}

export function createCachedResponse(
  payload: CachePayload,
  kind: "messages" | "chat/completions" | "responses",
  isStream: boolean,
  modelName: string,
  requestId: string
): Response {
  if (!isStream) {
    return new Response(JSON.stringify(payload.jsonBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Cache": "HIT",
        "X-Cache-Key": payload.model,
      },
    });
  }

  // Stream synthesis for Cache HIT
  let sseBody = "";
  const nowUnix = Math.floor(Date.now() / 1000);

  if (kind === "chat/completions") {
    const choice = payload.jsonBody?.choices?.[0];
    const content = choice?.message?.content || "";
    const finishReason = choice?.finish_reason || "stop";

    const chunk1 = {
      id: `chatcmpl-${requestId}`,
      object: "chat.completion.chunk",
      created: nowUnix,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        },
      ],
    };

    const chunk2 = {
      id: `chatcmpl-${requestId}`,
      object: "chat.completion.chunk",
      created: nowUnix,
      model: modelName,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    };

    sseBody = `data: ${JSON.stringify(chunk1)}\n\ndata: ${JSON.stringify(chunk2)}\n\ndata: [DONE]\n\n`;
  } else if (kind === "messages") {
    const contentText = payload.jsonBody?.content?.[0]?.text || "";
    const msgId = payload.jsonBody?.id || `msg_${requestId}`;
    const stopReason = payload.jsonBody?.stop_reason || "end_turn";

    const events = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", model: modelName, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: payload.usage.input_tokens, output_tokens: 0 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: contentText } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: payload.usage.output_tokens } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ];
    sseBody = events.join("");
  } else if (kind === "responses") {
    const messageItem = Array.isArray(payload.jsonBody?.output)
      ? payload.jsonBody.output.find((it: any) => it.type === "message") || payload.jsonBody.output[0]
      : null;
    const text = messageItem?.content?.[0]?.text || "";
    const respId = payload.jsonBody?.id || `resp_${requestId}`;
    const events = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: respId, object: "response", status: "in_progress", model: modelName } })}\n\n`,
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { id: `item_${requestId}`, type: "message", role: "assistant", content: [] } })}\n\n`,
      `event: response.content_part.added\ndata: ${JSON.stringify({ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", response_id: respId, item_id: `item_${requestId}`, output_index: 0, content_index: 0, delta: text })}\n\n`,
      `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", response_id: respId, item_id: `item_${requestId}`, output_index: 0, content_index: 0, text })}\n\n`,
      `event: response.content_part.done\ndata: ${JSON.stringify({ type: "response.content_part.done", response_id: respId, item_id: `item_${requestId}`, output_index: 0, content_index: 0, part: { type: "output_text", text } })}\n\n`,
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { id: `item_${requestId}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] } })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: respId, object: "response", status: "completed", model: modelName, output: [messageItem || { id: `item_${requestId}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }], usage: payload.usage } })}\n\n`,
    ];
    sseBody = events.join("");
  }

  return new Response(sseBody, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Cache": "HIT",
      "X-Cache-Key": payload.model,
    },
  });
}
