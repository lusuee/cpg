import { Hono } from "hono";
import type { Env } from "../types";
import { generateDeviceToken, hashToken } from "../utils/crypto";
import {
  createDevice,
  listDevices,
  revokeDevice,
  updateDevice,
} from "../db/repo";

export const devicesApp = new Hono<{ Bindings: Env }>();

devicesApp.get("/", async (c) => {
  const items = await listDevices(c.env);
  return c.json({ items });
});

devicesApp.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string") return c.json({ error: "name is required" }, 400);
  const token = generateDeviceToken();
  const tokenHash = await hashToken(token);
  const device = await createDevice(c.env, body.name, tokenHash);
  return c.json({ item: device, token }, 201);
});

devicesApp.put("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const row = await updateDevice(c.env, c.req.param("id"), {
    name: typeof body.name === "string" ? body.name : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});

devicesApp.post("/:id/revoke", async (c) => {
  const row = await revokeDevice(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: row });
});
