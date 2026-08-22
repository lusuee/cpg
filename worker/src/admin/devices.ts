import { Hono } from "hono";
import type { Env } from "../types";
import { generateDeviceToken, hashToken } from "../utils/crypto";
import {
  createDevice,
  listDevices,
  revokeDevice,
  updateDevice,
} from "../db/repo";

import { CreateDeviceSchema, UpdateDeviceSchema, zValidator } from "./schemas";

export const devicesApp = new Hono<{ Bindings: Env }>();

devicesApp.get("/", async (c) => {
  const items = await listDevices(c.env);
  return c.json({ items });
});

devicesApp.post("/", zValidator("json", CreateDeviceSchema), async (c) => {
  const data = c.req.valid("json");
  const rateLimitRpm = typeof data.rate_limit_rpm === "number" ? Math.max(0, data.rate_limit_rpm) : 0;
  const costLimitMonthly = typeof data.cost_limit_monthly === "number" ? Math.max(0, data.cost_limit_monthly) : 0;
  const token = generateDeviceToken();
  const tokenHash = await hashToken(token);
  const device = await createDevice(c.env, data.name.trim(), tokenHash, rateLimitRpm, costLimitMonthly);
  return c.json({ item: device, token }, 201);
});

devicesApp.put("/:id", zValidator("json", UpdateDeviceSchema), async (c) => {
  const data = c.req.valid("json");
  const row = await updateDevice(c.env, c.req.param("id"), {
    name: data.name !== undefined ? data.name.trim() : undefined,
    enabled: data.enabled,
    rate_limit_rpm: typeof data.rate_limit_rpm === "number" ? Math.max(0, data.rate_limit_rpm) : undefined,
    cost_limit_monthly: typeof data.cost_limit_monthly === "number" ? Math.max(0, data.cost_limit_monthly) : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});

devicesApp.post("/:id/revoke", async (c) => {
  const row = await revokeDevice(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});
