import { MiddlewareHandler } from "hono";
import type { Env, IpWhitelistConfig } from "../types";
import { verifySession } from "../utils/crypto";
import { getSetting } from "../db/repo";

export function extractClientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xReal = c.req.header("x-real-ip");
  if (xReal) return xReal.trim();
  return "127.0.0.1";
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (ip === cidr) return true;
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bitsStr] = cidr.split("/");
  const prefixBits = parseInt(bitsStr, 10);
  if (isNaN(prefixBits)) return false;

  const ipToLong = (v: string) => {
    return v.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  };

  try {
    const ipLong = ipToLong(ip);
    const rangeLong = ipToLong(range);
    const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  } catch {
    return false;
  }
}

export function isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;
  for (const pattern of allowedIps) {
    const p = pattern.trim();
    if (!p) continue;
    if (p === "*" || p === clientIp) return true;
    if (clientIp === "127.0.0.1" && (p === "localhost" || p === "::1")) return true;
    if (clientIp === "::1" && (p === "localhost" || p === "127.0.0.1")) return true;
    if (p.includes("/") && isIpInCidr(clientIp, p)) return true;
  }
  return false;
}

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // 1. IP Whitelist Enforcement
  const clientIp = extractClientIp(c);
  const ipConfig = await getSetting<IpWhitelistConfig>(c.env, "ip_whitelist_config");
  if (ipConfig?.enabled && Array.isArray(ipConfig.allowed_ips) && ipConfig.allowed_ips.length > 0) {
    if (!isIpAllowed(clientIp, ipConfig.allowed_ips)) {
      return c.json(
        {
          error: "ip_not_allowed",
          message: `Client IP ${clientIp} is not in the allowed admin IP whitelist`,
          client_ip: clientIp,
        },
        403
      );
    }
  }

  // 2. Check Cloudflare Access authenticated email header ONLY if whitelist is explicitly configured
  const cfAccessEmail = c.req.header("Cf-Access-Authenticated-User-Email");
  const allowedEmailsStr = c.env.CF_ACCESS_ALLOWED_EMAILS;

  if (cfAccessEmail && allowedEmailsStr) {
    const allowed = allowedEmailsStr.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && allowed.includes(cfAccessEmail.toLowerCase())) {
      return next();
    }
  }

  // 3. Cookie Session Auth
  const secret = c.env.SESSION_SECRET || c.env.ADMIN_SECRET;
  if (!secret) {
    return c.json({ error: "ADMIN_SECRET not configured" }, 500);
  }
  const payload = await verifySession(secret, c.req.header("cookie"));
  if (!payload) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};


