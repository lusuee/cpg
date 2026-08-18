import { Hono } from "hono";
import type { Env } from "../types";
import { adminAuth } from "../middleware/adminAuth";
import { authApp } from "./auth";
import { providersApp } from "./providers";
import { modelsApp } from "./models";
import { devicesApp } from "./devices";
import { usageApp } from "./usage";
import { settingsApp } from "./settings";

export const adminApp = new Hono<{ Bindings: Env }>();

adminApp.get("/health", (c) => c.json({ ok: true, service: "personal-ai-gateway" }));

// Public auth routes: /api/auth/*
adminApp.route("/auth", authApp);

// Everything below requires a valid admin session cookie.
adminApp.use("*", adminAuth);

adminApp.route("/providers", providersApp);
adminApp.route("/models", modelsApp);
adminApp.route("/devices", devicesApp);
adminApp.route("/usage", usageApp);
adminApp.route("/settings", settingsApp);
