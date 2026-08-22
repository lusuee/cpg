#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = path.join(root, "worker");
const wranglerToml = path.join(workerDir, "wrangler.toml");
const deployEnvFile = path.join(root, "deploy.env");

function getWranglerCli() {
  const candidates = [
    path.join(workerDir, "node_modules", "wrangler", "wrangler-dist", "cli.js"),
    path.join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js"),
    path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js"),
    path.join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return path.join(workerDir, "node_modules", "wrangler", "wrangler-dist", "cli.js");
}

const D1_NAME = "personal-ai-gateway";
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SECRET_KEYS = ["ADMIN_SECRET", "SESSION_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
const VAR_KEYS = ["GATEWAY_BASE_URL", "APP_NAME", "CF_ACCESS_ALLOWED_EMAILS"];

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
    console.log(`Loaded deploy env file: ${deployEnvFile}`);
  }

  // Merge process.env (GitHub Actions secrets/variables take precedence)
  for (const [key, value] of Object.entries(process.env)) {
    if (value && (key.endsWith("_KEY") || key.endsWith("_SECRET") || VAR_KEYS.includes(key) || key === "D1_DATABASE_ID" || key.startsWith("CLOUDFLARE_"))) {
      env[key] = value;
    }
  }
  return env;
}

function runWrangler(args, { input, cwd = workerDir } = {}) {
  const wranglerCli = getWranglerCli();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
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

  if (!id || id === PLACEHOLDER_ID) {
    logStep(`Checking or auto-creating D1 database "${D1_NAME}" via Wrangler`);
    const listRes = await runWrangler(["d1", "list", "--json"]);
    let foundId = "";
    if (listRes.code === 0 && listRes.stdout) {
      try {
        const jsonMatch = listRes.stdout.match(/\[\s*\{.*\}\s*\]/s);
        if (jsonMatch) {
          const list = JSON.parse(jsonMatch[0]);
          const found = list.find((db) => db.name === D1_NAME);
          if (found && (found.uuid || found.database_id)) {
            foundId = found.uuid || found.database_id;
            console.log(`Found existing D1 database "${D1_NAME}": ${mask(foundId)}`);
          }
        }
      } catch (e) {
        // ignore parse error
      }
    }

    if (!foundId) {
      logStep(`Creating D1 database "${D1_NAME}" automatically...`);
      const createRes = await runWrangler(["d1", "create", D1_NAME]);
      const match =
        createRes.stdout.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) ||
        createRes.stdout.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) {
        foundId = match[1];
        console.log(`Successfully created D1 database "${D1_NAME}": ${mask(foundId)}`);
      } else {
        throw new Error(`Failed to create or parse D1 database ID. Wrangler output:\n${createRes.stdout || createRes.stderr}`);
      }
    }
    id = foundId;
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
  const secretKeys = new Set([...DEFAULT_SECRET_KEYS]);
  for (const k of Object.keys(env)) {
    if ((k.endsWith("_KEY") || k.endsWith("_SECRET")) && !VAR_KEYS.includes(k) && k !== "D1_DATABASE_ID") {
      secretKeys.add(k);
    }
  }

  for (const key of secretKeys) {
    const value = env[key];
    if (!value) {
      console.log(`Skip secret ${key}: not configured`);
      continue;
    }
    logStep(`Uploading secret ${key}`);
    const { code } = await runWrangler(["secret", "put", key], { input: `${value}\n` });
    if (code !== 0) throw new Error(`Failed to set secret ${key}`);
  }
}

async function main() {
  const env = loadEnv();

  if ((process.env.CI || process.env.GITHUB_ACTIONS) && !process.env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_API_TOKEN) {
    console.error("\n❌ [部署错误 / Deploy Error]: 缺少 CLOUDFLARE_API_TOKEN 环境变量！");
    console.error("👉 原因：在 GitHub Actions 等非交互式 CI/CD 环境中，Wrangler 无法弹出浏览器交互式登录，必须配置 CLOUDFLARE_API_TOKEN 令牌进行鉴权。");
    console.error("👉 解决方法：");
    console.error("   1. 前往 Cloudflare API Tokens 页面: https://dash.cloudflare.com/profile/api-tokens");
    console.error("   2. 点击 'Create Token'，选择 'Edit Cloudflare Workers' 模板，并在 Permissions 中确保包含 'Account - D1 - Edit' 权限后创建。");
    console.error("   3. 前往 GitHub 仓库: Settings -> Secrets and variables -> Actions -> 点击 'New repository secret'");
    console.error("   4. Name 填入: CLOUDFLARE_API_TOKEN，Secret 填入生成的 Token 字符串，保存后重新触发部署即可！\n");
    throw new Error("Missing CLOUDFLARE_API_TOKEN in CI environment");
  }

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
