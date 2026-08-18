import { Hono } from "hono";
import type { Env } from "../types";
import { buildSessionCookie, clearSessionCookie, safeEqual, signSession } from "../utils/crypto";
import { adminAuth } from "../middleware/adminAuth";

export const authApp = new Hono<{ Bindings: Env }>();

authApp.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const expected = c.env.ADMIN_SECRET;
  if (!expected || !password || !safeEqual(password, expected)) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const session = await signSession(c.env.SESSION_SECRET || "");
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
