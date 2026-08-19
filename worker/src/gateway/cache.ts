import type { Env, TokenUsage } from "../types";

export interface CachePayload {
  kind: "messages" | "chat/completions" | "responses";
  model: string;
  jsonBody: any;
  usage: TokenUsage;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: string;
  createdAt: number;
}

interface L1CacheEntry {
  payload: CachePayload;
  expiresAt: number;
  lastAccessed: number;
}

export class L1MemoryCache {
  private cache = new Map<string, L1CacheEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  get(key: string): CachePayload | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU order
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.payload;
  }

  set(key: string, payload: CachePayload, ttlSeconds: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      payload,
      expiresAt: Date.now() + Math.max(60, ttlSeconds) * 1000,
      lastAccessed: Date.now(),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  purgeByModel(modelName: string): number {
    let count = 0;
    for (const [k, v] of this.cache.entries()) {
      if (v.payload.model === modelName || k.includes(`:${modelName}:`)) {
        this.cache.delete(k);
        count++;
      }
    }
    return count;
  }

  size(): number {
    return this.cache.size;
  }
}

export const l1MemoryCache = new L1MemoryCache(500);

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

export function stripVolatileMetadata(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
    .replace(/The current local time is:\s*[^\n\r]+/gi, "")
    .replace(/Current (?:date|time|timestamp):\s*[^\n\r]+/gi, "")
    .replace(/Timestamp:\s*\d{10,13}/gi, "")
    .trim();
}

function normalizeContent(content: any): any {
  if (content === null || content === undefined) return content;
  if (typeof content === "string") return stripVolatileMetadata(content);
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return stripVolatileMetadata(item);
      if (item && typeof item === "object") {
        const res: Record<string, any> = { ...item };
        if (typeof res.text === "string") res.text = stripVolatileMetadata(res.text);
        if (typeof res.input_text === "string") res.input_text = stripVolatileMetadata(res.input_text);
        if (typeof res.output_text === "string") res.output_text = stripVolatileMetadata(res.output_text);
        return res;
      }
      return item;
    });
  }
  return content;
}

function normalizeMessages(messages: any): any {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    return {
      role: m.role || "user",
      content: normalizeContent(m.content),
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
    };
  });
}

function normalizeInput(input: any): any {
  if (!input) return undefined;
  if (typeof input === "string") return stripVolatileMetadata(input);
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item === "string") return stripVolatileMetadata(item);
      if (item && typeof item === "object") {
        return {
          type: item.type,
          role: item.role,
          content: normalizeContent(item.content),
          text: typeof item.text === "string" ? stripVolatileMetadata(item.text) : item.text,
          name: item.name,
          arguments: item.arguments,
          output: item.output,
        };
      }
      return item;
    });
  }
  return input;
}

export async function computeCacheKey(
  kind: "messages" | "chat/completions" | "responses",
  modelName: string,
  body: any
): Promise<string> {
  const normalized: Record<string, any> = {
    kind,
    model: modelName,
    messages: normalizeMessages(body.messages),
    system: typeof body.system === "string" ? stripVolatileMetadata(body.system) : body.system,
    instructions: typeof body.instructions === "string" ? stripVolatileMetadata(body.instructions) : body.instructions,
    input: normalizeInput(body.input),
    prompt: typeof body.prompt === "string" ? stripVolatileMetadata(body.prompt) : body.prompt,
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

export function shouldBypassCache(headers: Headers, _body: any): boolean {
  if (headers.get("x-cache-bypass") === "true") return true;
  const cc = headers.get("cache-control") || "";
  if (cc.includes("no-cache") || cc.includes("no-store")) return true;
  return false;
}

export async function getCachedEntry(env: Env, key: string): Promise<CachePayload | null> {
  // 1. Check L1 Memory Cache (Sub-millisecond)
  const l1 = l1MemoryCache.get(key);
  if (l1) return l1;

  // 2. Check L2 Cloudflare KV (Persistent)
  if (env.CACHE_KV) {
    try {
      const val = await env.CACHE_KV.get(key, "json");
      if (val) {
        const payload = val as CachePayload;
        // Populate L1 cache for subsequent repeated calls
        l1MemoryCache.set(key, payload, 3600);
        return payload;
      }
    } catch {
      // KV read failure fallback
    }
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

  // 1. Populate L1 Memory Cache
  l1MemoryCache.set(key, payload, validTtl);

  // 2. Populate L2 Cloudflare KV
  if (env.CACHE_KV) {
    try {
      await env.CACHE_KV.put(key, JSON.stringify(payload), { expirationTtl: validTtl });
    } catch {
      // Ignore KV write errors
    }
  }
}

export async function purgeCache(
  env: Env,
  options?: { model?: string }
): Promise<{ ok: boolean; cleared: number }> {
  let cleared = 0;

  if (options?.model) {
    cleared += l1MemoryCache.purgeByModel(options.model);
    if (env.CACHE_KV) {
      try {
        const prefix = `aigw:cache:`;
        const list = await env.CACHE_KV.list({ prefix, limit: 1000 });
        for (const k of list.keys) {
          if (k.name.includes(`:${options.model}:`)) {
            await env.CACHE_KV.delete(k.name);
            cleared++;
          }
        }
      } catch {
        // ignore
      }
    }
  } else {
    cleared += l1MemoryCache.size();
    l1MemoryCache.clear();
    if (env.CACHE_KV) {
      try {
        const prefix = `aigw:cache:`;
        const list = await env.CACHE_KV.list({ prefix, limit: 1000 });
        for (const k of list.keys) {
          await env.CACHE_KV.delete(k.name);
          cleared++;
        }
      } catch {
        // ignore
      }
    }
  }

  return { ok: true, cleared };
}

export function clearMemoryCacheForTest(): void {
  l1MemoryCache.clear();
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
    const reasoning = payload.reasoning || choice?.message?.reasoning_content || "";
    const finishReason = choice?.finish_reason || "stop";

    const chunks: string[] = [];

    if (reasoning) {
      chunks.push(`data: ${JSON.stringify({
        id: `chatcmpl-${requestId}`,
        object: "chat.completion.chunk",
        created: nowUnix,
        model: modelName,
        choices: [{ index: 0, delta: { role: "assistant", reasoning_content: reasoning }, finish_reason: null }],
      })}\n\n`);
    }

    if (content) {
      chunks.push(`data: ${JSON.stringify({
        id: `chatcmpl-${requestId}`,
        object: "chat.completion.chunk",
        created: nowUnix,
        model: modelName,
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      })}\n\n`);
    }

    chunks.push(`data: ${JSON.stringify({
      id: `chatcmpl-${requestId}`,
      object: "chat.completion.chunk",
      created: nowUnix,
      model: modelName,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    })}\n\n`);

    chunks.push(`data: [DONE]\n\n`);
    sseBody = chunks.join("");
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
    const respId = payload.jsonBody?.id || `resp_${requestId}`;
    const events: string[] = [];
    let outputIndex = 0;

    events.push(`event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: respId, object: "response", status: "in_progress", model: modelName } })}\n\n`);

    // 1. Replay reasoning if present
    const reasoningItem = Array.isArray(payload.jsonBody?.output)
      ? payload.jsonBody.output.find((it: any) => it.type === "reasoning")
      : null;
    const reasoningText = payload.reasoning || "";

    if (reasoningItem || reasoningText) {
      const rIndex = outputIndex++;
      events.push(`event: response.output_item.added\ndata: ${JSON.stringify({ response_id: respId, output_index: rIndex, item: { id: `reasoning_${requestId}`, type: "reasoning", status: "in_progress", summary: [] } })}\n\n`);
      if (reasoningText) {
        events.push(`event: response.reasoning_text.delta\ndata: ${JSON.stringify({ response_id: respId, item_id: `reasoning_${requestId}`, output_index: rIndex, content_index: 0, delta: reasoningText })}\n\n`);
        events.push(`event: response.reasoning.delta\ndata: ${JSON.stringify({ response_id: respId, item_id: `reasoning_${requestId}`, output_index: rIndex, delta: reasoningText })}\n\n`);
      }
      events.push(`event: response.output_item.done\ndata: ${JSON.stringify({ response_id: respId, output_index: rIndex, item: { id: `reasoning_${requestId}`, type: "reasoning", status: "completed", summary: [] } })}\n\n`);
    }

    // 2. Replay message content
    const messageItem = Array.isArray(payload.jsonBody?.output)
      ? payload.jsonBody.output.find((it: any) => it.type === "message")
      : null;
    const text = messageItem?.content?.[0]?.text || "";

    if (text) {
      const mIndex = outputIndex++;
      events.push(`event: response.output_item.added\ndata: ${JSON.stringify({ response_id: respId, output_index: mIndex, item: { id: `item_${requestId}`, type: "message", role: "assistant", content: [] } })}\n\n`);
      events.push(`event: response.content_part.added\ndata: ${JSON.stringify({ response_id: respId, item_id: `item_${requestId}`, output_index: mIndex, content_index: 0, part: { type: "output_text", text: "" } })}\n\n`);
      events.push(`event: response.output_text.delta\ndata: ${JSON.stringify({ response_id: respId, item_id: `item_${requestId}`, output_index: mIndex, content_index: 0, delta: text })}\n\n`);
      events.push(`event: response.output_text.done\ndata: ${JSON.stringify({ response_id: respId, item_id: `item_${requestId}`, output_index: mIndex, content_index: 0, text })}\n\n`);
      events.push(`event: response.content_part.done\ndata: ${JSON.stringify({ response_id: respId, item_id: `item_${requestId}`, output_index: mIndex, content_index: 0, part: { type: "output_text", text } })}\n\n`);
      events.push(`event: response.output_item.done\ndata: ${JSON.stringify({ response_id: respId, output_index: mIndex, item: { id: `item_${requestId}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] } })}\n\n`);
    }

    // 3. Replay function calls if present
    const functionCallItems = Array.isArray(payload.jsonBody?.output)
      ? payload.jsonBody.output.filter((it: any) => it.type === "function_call")
      : [];

    for (const fc of functionCallItems) {
      const fIndex = outputIndex++;
      const fItemId = fc.id || `call_${fc.call_id || requestId}`;
      events.push(`event: response.output_item.added\ndata: ${JSON.stringify({ response_id: respId, output_index: fIndex, item: { id: fItemId, type: "function_call", status: "in_progress", call_id: fc.call_id, name: fc.name, arguments: "" } })}\n\n`);
      events.push(`event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ response_id: respId, item_id: fItemId, output_index: fIndex, call_id: fc.call_id, delta: fc.arguments || "{}" })}\n\n`);
      events.push(`event: response.function_call_arguments.done\ndata: ${JSON.stringify({ response_id: respId, item_id: fItemId, output_index: fIndex, call_id: fc.call_id, arguments: fc.arguments || "{}" })}\n\n`);
      events.push(`event: response.output_item.done\ndata: ${JSON.stringify({ response_id: respId, output_index: fIndex, item: { id: fItemId, type: "function_call", status: "completed", call_id: fc.call_id, name: fc.name, arguments: fc.arguments || "{}" } })}\n\n`);
    }

    events.push(`event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: respId,
        object: "response",
        status: "completed",
        model: modelName,
        output: payload.jsonBody?.output || [{ id: `item_${requestId}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
        usage: payload.usage,
      },
    })}\n\n`);

    events.push(`data: [DONE]\n\n`);
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
