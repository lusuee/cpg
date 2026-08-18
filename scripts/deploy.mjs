#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "worker");
const wranglerCli = path.join(workerDir, "node_modules", "wrangler", "wrangler-dist", "cli.js");
const wranglerToml = path.join(workerDir, "wrangler.toml");
const deployEnvFile = path.join(root, "deploy.env");

const D1_NAME = "personal-ai-gateway";
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const SECRET_KEYS = ["ADMIN_SECRET", "SESSION_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
const VAR_KEYS = ["GATEWAY_BASE_URL", "APP_NAME"];
const ENV_KEYS = [...SECRET_KEYS, "D1_DATABASE_ID", ...VAR_KEYS];

function loadEnv() {
  const env = {};
  if (existsSync(deployEnvFile)) {
    for (const raw of readFileSync(deployEnvFile, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    console.log(`Loaded deploy env: ${deployEnvFile}`);
  }
  for (const key of ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runWrangler(args, { input, cwd = workerDir } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function patchToml(toml, key, value) {
  const re = new RegExp(`(${key}\\s*=\\s*)"[^"]*"`);
  if (!re.test(toml)) throw new Error(`Missing ${key} in worker/wrangler.toml`);
  return toml.replace(re, `$1"${value.replace(/"/g, '\\"')}"`);
}

function runPnpm(args) {
  const cmd = /^win/.test(process.platform) ? "pnpm.cmd" : "pnpm";
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed (exit ${res.status})`);
}

function logStep(msg) {
  console.log(`\n==> ${msg}`);
}

function mask(value) {
  if (!value || value.length <= 8) return value || "(empty)";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function prepareD1Id(env) {
  let toml = readFileSync(wranglerToml, "utf8");
  let id = env.D1_DATABASE_ID || "";
  if (!id) {
    const m = toml.match(/database_id\s*=\s*"([^"]+)"/);
    id = m ? m[1] : "";
  }
  if (!id) throw new Error("Cannot find database_id in worker/wrangler.toml");
  if (id === PLACEHOLDER_ID) {
    throw new Error("worker/wrangler.toml still has the placeholder D1 id. Set D1_DATABASE_ID in deploy.env (or export it) to the id shown in Cloudflare console.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error(`Invalid D1 database id: ${mask(id)}`);
  }
  if (!toml.includes(`database_id = "${id}"`)) {
    toml = patchToml(toml, "database_id", id);
    writeFileSync(wranglerToml, toml, "utf8");
    console.log(`Patched worker/wrangler.toml with D1 database id: ${mask(id)}`);
  } else {
    console.log(`D1 database id ok: ${mask(id)}`);
  }
  return toml;
}

async function configureVars(env, toml) {
  for (const key of VAR_KEYS) {
    const value = env[key];
    if (!value) continue;
    if (toml.includes(`${key} = "${value}"`)) continue;
    toml = patchToml(toml, key, value);
  }
  writeFileSync(wranglerToml, toml, "utf8");
  return toml;
}

async function applyMigrations() {
  logStep(`Applying D1 migrations to ${D1_NAME} (remote)`);
  const { code } = await runWrangler(["d1", "migrations", "apply", D1_NAME, "--remote"]);
  if (code !== 0) throw new Error("Remote migration failed");
}

async function setSecrets(env) {
  for (const key of SECRET_KEYS) {
    const value = env[key];
    if (!value) {
      console.log(`Skip secret ${key}: not present in deploy.env`);
      continue;
    }
    logStep(`Uploading secret ${key}`);
    const { code } = await runWrangler(["secret", "put", key], { input: `${value}\n` });
    if (code !== 0) throw new Error(`Failed to set secret ${key}`);
  }
}

async function main() {
  const env = loadEnv();

  logStep("Building web dashboard");
  runPnpm(["build:web"]);

  logStep("Preparing D1 database id");
  let toml = await prepareD1Id(env);

  logStep("Configuring vars from deploy.env");
  toml = await configureVars(env, toml);

  await applyMigrations();

  await setSecrets(env);

  logStep("Deploying Worker to Cloudflare");
  const { code } = await runWrangler(["deploy"]);
  if (code !== 0) throw new Error("wrangler deploy failed");
  console.log("\nDeploy done.");
}

main().catch((err) => {
  console.error(`\n[deploy] ${err.message}`);
  process.exit(1);
});
