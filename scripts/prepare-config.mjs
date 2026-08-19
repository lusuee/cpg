#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerToml = path.join(root, "worker", "wrangler.toml");

if (existsSync(wranglerToml)) {
  let toml = readFileSync(wranglerToml, "utf8");
  let modified = false;

  const d1Id = process.env.D1_DATABASE_ID;
  if (d1Id && /^[0-9a-f-]{36}$/i.test(d1Id)) {
    const re = /(database_id\s*=\s*)"[^"]*"/;
    if (re.test(toml)) {
      toml = toml.replace(re, `$1"${d1Id}"`);
      modified = true;
      console.log(`[prepare-config] Injected D1_DATABASE_ID into wrangler.toml: ${d1Id.slice(0, 4)}...${d1Id.slice(-4)}`);
    }
  }

  const gatewayUrl = process.env.GATEWAY_BASE_URL;
  if (gatewayUrl) {
    const re = /(GATEWAY_BASE_URL\s*=\s*)"[^"]*"/;
    if (re.test(toml)) {
      toml = toml.replace(re, `$1"${gatewayUrl}"`);
      modified = true;
      console.log(`[prepare-config] Injected GATEWAY_BASE_URL into wrangler.toml: ${gatewayUrl}`);
    }
  }

  const appName = process.env.APP_NAME;
  if (appName) {
    const re = /(APP_NAME\s*=\s*)"[^"]*"/;
    if (re.test(toml)) {
      toml = toml.replace(re, `$1"${appName}"`);
      modified = true;
      console.log(`[prepare-config] Injected APP_NAME into wrangler.toml: ${appName}`);
    }
  }

  if (modified) {
    writeFileSync(wranglerToml, toml, "utf8");
  }
}
