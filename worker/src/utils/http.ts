import type { ProviderType } from "../types";

const BLOCKED_REQUEST_HEADERS = new Set([
  "host",
  "authorization",
  "x-api-key",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

const BLOCKED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  "set-cookie",
]);

export function buildUpstreamHeaders(
  source: Headers,
  providerType: ProviderType,
  upstreamKey: string
): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) return;
    // Forward provider-specific headers (e.g. anthropic-version/beta).
    if (key.toLowerCase().startsWith("anthropic-")) return headers.append(key, value);
    if (key.toLowerCase().startsWith("x-")) return headers.append(key, value);
    if (key.toLowerCase() === "content-type") return headers.append(key, value);
    if (key.toLowerCase() === "accept") return headers.append(key, value);
    if (key.toLowerCase() === "accept-language") return headers.append(key, value);
  });

  if (providerType === "anthropic") {
    headers.set("x-api-key", upstreamKey);
  } else if (providerType === "gemini") {
    headers.set("x-goog-api-key", upstreamKey);
    headers.set("Authorization", `Bearer ${upstreamKey}`);
  } else {
    headers.set("Authorization", `Bearer ${upstreamKey}`);
  }
  headers.set("User-Agent", "personal-ai-gateway/0.1");
  return headers;
}

export function cleanResponseHeaders(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (BLOCKED_RESPONSE_HEADERS.has(k)) return;
    out.set(key, value);
  });
  return out;
}

export function addGatewayCorsHeaders(headers: Headers, origin?: string | null): boolean {
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key, anthropic-version");
  headers.set("Access-Control-Max-Age", "86400");
  return true;
}
