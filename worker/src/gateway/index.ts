import { Hono } from "hono";
import type { Env } from "../types";
import { addGatewayCorsHeaders } from "../utils/http";
import { handleGatewayProxy, listModelsHandler } from "./proxy";

export const gatewayApp = new Hono<{ Bindings: Env }>();

gatewayApp.use("*", async (c, next) => {
  const headers = new Headers();
  addGatewayCorsHeaders(headers, c.req.header("origin"));
  await next();
  c.header("Access-Control-Allow-Origin", headers.get("Access-Control-Allow-Origin") || "*");
  c.header("Access-Control-Allow-Methods", headers.get("Access-Control-Allow-Methods") || "");
  c.header("Access-Control-Allow-Headers", headers.get("Access-Control-Allow-Headers") || "");
  c.header("Access-Control-Max-Age", headers.get("Access-Control-Max-Age") || "86400");
});

gatewayApp.options("*", (c) => c.newResponse(null, 204));

gatewayApp.get("/models", (c) => listModelsHandler(c));

gatewayApp.post("/messages", (c) => handleGatewayProxy(c, "messages"));
gatewayApp.post("/chat/completions", (c) => handleGatewayProxy(c, "chat/completions"));
gatewayApp.post("/responses", (c) => handleGatewayProxy(c, "responses"));

gatewayApp.notFound((c) => c.json({ error: "not_found" }, 404));
