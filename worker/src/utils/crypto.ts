const enc = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

export function generateDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "ccs_" + bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  admin: boolean;
  exp: number;
}

export async function signSession(secret: string): Promise<string> {
  const payload: SessionPayload = { admin: true, exp: Date.now() + SESSION_TTL_MS };
  const body = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(secret: string, cookieHeader: string | null | undefined): Promise<SessionPayload | null> {
  if (!secret || !cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return null;
  const value = cookie.slice(SESSION_COOKIE.length + 1);
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await hmacSha256Base64Url(secret, body);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as SessionPayload;
    if (!payload.admin || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildSessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function randomUUID(): string {
  return crypto.randomUUID();
}
