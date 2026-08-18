import type { Context } from "hono";
import type { Env } from "../types";
import { getDeviceByHash } from "../db/repo";
import { sha256Hex } from "../utils/crypto";

export async function authenticateGateway(c: Context<{ Bindings: Env }>) {
  const auth = c.req.header("authorization") || "";
  let token = "";
  if (auth.startsWith("Bearer ")) {
    token = auth.slice(7).trim();
  } else {
    token = c.req.header("x-api-key")?.trim() || "";
  }
  if (!token) return null;
  const hash = await sha256Hex(token);
  const device = await getDeviceByHash(c.env, hash);
  if (!device || !device.enabled || device.revoked_at) return null;
  return device;
}
