import { Hono } from "hono";
import type { Env } from "../types";
import { buildSessionCookie, clearSessionCookie, safeEqual, signSession } from "../utils/crypto";
import { adminAuth } from "../middleware/adminAuth";
import { LoginSchema, zValidator } from "./schemas";

export const authApp = new Hono<{ Bindings: Env }>();

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function checkLoginLock(ip: string): { locked: boolean; remainingSec: number } {
  const record = loginAttempts.get(ip);
  if (!record) return { locked: false, remainingSec: 0 };
  const now = Date.now();
  if (record.lockedUntil > now) {
    return { locked: true, remainingSec: Math.ceil((record.lockedUntil - now) / 1000) };
  }
  if (now > record.lockedUntil && record.lockedUntil > 0) {
    loginAttempts.delete(ip);
  }
  return { locked: false, remainingSec: 0 };
}

function recordFailedLogin(ip: string) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = now + 5 * 60 * 1000; // Lock for 5 minutes
  }
  loginAttempts.set(ip, record);
}

function clearFailedLogin(ip: string) {
  loginAttempts.delete(ip);
}

export function resetLoginAttemptsForTest() {
  loginAttempts.clear();
}

authApp.post("/login", zValidator("json", LoginSchema), async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown-ip";
  const lock = checkLoginLock(clientIp);
  if (lock.locked) {
    return c.json(
      {
        error: "too_many_attempts",
        message: `密码错误次数过多，已被临时锁定，请在 ${lock.remainingSec} 秒后再试`,
      },
      429
    );
  }

  const { password } = c.req.valid("json");
  const expected = c.env.ADMIN_SECRET;
  if (!expected) {
    return c.json({ error: "ADMIN_SECRET_NOT_CONFIGURED: 请在 Cloudflare 环境变量中配置 ADMIN_SECRET" }, 500);
  }
  const match = safeEqual(password, expected) || safeEqual(password.trim(), expected.trim());
  if (!match) {
    recordFailedLogin(clientIp);
    return c.json({ error: "invalid_credentials" }, 401);
  }

  clearFailedLogin(clientIp);
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
