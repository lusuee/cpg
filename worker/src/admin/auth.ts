import { Hono } from "hono";
import type { Env } from "../types";
import { buildSessionCookie, clearSessionCookie, safeEqual, signSession } from "../utils/crypto";
import { adminAuth } from "../middleware/adminAuth";
import { LoginSchema, zValidator } from "./schemas";

export const authApp = new Hono<{ Bindings: Env }>();

authApp.post("/login", zValidator("json", LoginSchema), async (c) => {
  const { password } = c.req.valid("json");
  const expected = c.env.ADMIN_SECRET;
  if (!expected) {
    return c.json({ error: "ADMIN_SECRET_NOT_CONFIGURED: 请在 Cloudflare 环境变量中配置 ADMIN_SECRET" }, 500);
  }
  const match = safeEqual(password, expected) || safeEqual(password.trim(), expected.trim());
  if (!match) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const sessionSecret = c.env.SESSION_SECRET || c.env.ADMIN_SECRET || "";
  const session = await signSession(sessionSecret);
  c.header("Set-Cookie", buildSessionCookie(session));
  return c.json({ ok: true });
});

authApp.post("/logout", async (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

authApp.get("/me", adminAuth, async (c) => {
  return c.json({ ok: true, authenticated: true });
});
