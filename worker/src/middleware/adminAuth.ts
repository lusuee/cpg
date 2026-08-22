import { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { verifySession } from "../utils/crypto";

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // Check Cloudflare Access authenticated email header ONLY if whitelist is explicitly configured
  const cfAccessEmail = c.req.header("Cf-Access-Authenticated-User-Email");
  const allowedEmailsStr = c.env.CF_ACCESS_ALLOWED_EMAILS;

  if (cfAccessEmail && allowedEmailsStr) {
    const allowed = allowedEmailsStr.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && allowed.includes(cfAccessEmail.toLowerCase())) {
      return next();
    }
  }

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


