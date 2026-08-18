import { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { verifySession } from "../utils/crypto";

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) {
    return c.json({ error: "SESSION_SECRET not configured" }, 500);
  }
  const payload = await verifySession(secret, c.req.header("cookie"));
  if (!payload) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
