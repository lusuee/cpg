# Cloudflare 个人 AI Gateway V1 MVP

单管理员、单租户的个人 AI 网关，使用一个 Cloudflare Worker 同时提供：

- 管理 API（`/api/*`）与 Web Dashboard（React + Vite + Tailwind + Recharts，通过 Workers Static Assets 托管）。
- AI Gateway API（`/v1/*`）：V1 支持 Anthropic Messages 和 OpenAI-compatible Chat Completions。
  - 设备 Token 鉴权，兼容 `Authorization: Bearer <token>` 与 Anthropic SDK 的 `x-api-key`。
  - 非流式与流式 SSE 透明转发。
  - 用量记录写入 D1，用于 Dashboard 统计；D1 写失败不影响上游响应。

## 仓库结构

```
.
├── worker/                 # Cloudflare Worker (Hono + TypeScript)
│   ├── migrations/0001_init.sql
│   ├── src/
│   │   ├── admin/          # 管理 API
│   │   ├── gateway/        # AI Gateway 鉴权 / 代理 / usage 解析
│   │   ├── middleware/     # 管理端会话
│   │   ├── db/repo.ts      # D1 查询与统计
│   │   └── index.ts        # Worker 入口
│   └── test/               # vitest 单元测试
├── web/                    # React Dashboard
│   └── src/pages/          # Login/Dashboard/Providers/Models/Devices/Usage/Settings
└── pnpm-workspace.yaml
```

## 快速开始

前置条件：Node.js、pnpm、Wrangler CLI（或已登录的 `wrangler login`）。

```bash
# 1. 安装依赖
pnpm install

# 2. 本地开发
pnpm dev:worker        # wrangler dev，监听 8787
pnpm dev:web           # Vite dev server，代理 /api、/v1 到 wrangler dev

# 3. 本地 D1 迁移（首次）
pnpm db:migrate:local
```

登录管理端至少需要两个 Secret：`ADMIN_SECRET`（登录密码）和 `SESSION_SECRET`（会话签名密钥）。

## 配置 Secrets

```bash
npx wrangler secret put ADMIN_SECRET      # 管理端登录密码
npx wrangler secret put SESSION_SECRET    # 会话 HMAC 密钥，请用随机长字符串
npx wrangler secret put OPENAI_API_KEY    # 若使用 OpenAI/SDK 兼容 provider
npx wrangler secret put ANTHROPIC_API_KEY # 若使用 Anthropic provider
```

- Provider 表中的 `secret_name` 必须对应 Worker 环境变量/Secret 名称（例如 `OPENAI_API_KEY`）。
- Provider 创建/编辑后 Dashboard 会显示是否已配置对应 Secret。

## 创建 D1 并部署

```bash
# 1. 创建数据库（首次）
npx wrangler d1 create personal-ai-gateway

# 2. 把返回的 database_id 填入 worker/wrangler.toml
#    [[d1_databases]]
#    database_name = "personal-ai-gateway"
#    database_id = "<复制的 ID>"

# 3. 应用迁移到远程库
npx wrangler d1 migrations apply personal-ai-gateway --remote

# 4. 设置 Secrets 后构建并部署
pnpm deploy
```

部署结束后，把 `worker/wrangler.toml` 中的 `GATEWAY_BASE_URL` 改成你的真实域名（或通过 Dashboard 显示用途），例如 `https://ai.example.com`。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev:web` | Vite 开发服务器（代理到 worker） |
| `pnpm dev:worker` | Wrangler 本地运行 Worker |
| `pnpm build:web` | 构建 Dashboard 到 `web/dist` |
| `pnpm typecheck` | 全部 TypeScript 类型检查 |
| `pnpm test` | Worker vitest 单元测试 |
| `pnpm deploy` | 构建前端并由 Wrangler 部署 Worker |
| `pnpm db:migrate:local` | 本地 D1 迁移 |

## 管理 API

除 `/api/health` 与 `/api/auth/login` 外，`/api/*` 均要求管理端会话 Cookie。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 提交 `{ "password": "..." }`，成功后下发 HttpOnly/Secure 会话 Cookie |
| `POST` | `/api/auth/logout` | 清除会话 Cookie |
| `GET` | `/api/auth/me` | 校验当前会话 |
| `GET/POST` | `/api/providers` | Provider 列表/创建 |
| `PUT/DELETE` | `/api/providers/:id` | 更新/删除 Provider |
| `GET/POST` | `/api/models` | Model 列表/创建 |
| `PUT/DELETE` | `/api/models/:id` | 更新/删除 Model |
| `GET/POST` | `/api/devices` | 设备列表/创建设备（创建时仅返回一次 `ccs_` 原始 Token） |
| `PUT` | `/api/devices/:id` | 启用/禁用/改名设备 |
| `POST` | `/api/devices/:id/revoke` | 撤销设备 Token |
| `GET` | `/api/usage` | 用量明细，支持 `from/to/provider_id/model/device_id/limit/offset` |
| `GET` | `/api/usage/stats?range=today|7d|30d` | 统计汇总、按 Provider/Model 分布与趋势 |
| `GET` | `/api/settings` | Dashboard 设置信息 |

## Gateway API（设备调用）

V1 使用设备 Token 鉴权，不接管理端会话。支持两种方式传递 Token：

- `Authorization: Bearer <device-token>`
- Anthropic SDK 风格 `x-api-key: <device-token>`

可用端点：

| 路径 | 协议 |
| --- | --- |
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI-compatible Chat Completions |
| `GET /v1/models` | 返回已配置且启用的模型列表 |

请求中的 `model` 可以是 D1 Model 记录的 `model_name` 或 `alias`。Worker 会根据 Model 解析到 Provider 和上游 Key。

示例（OpenAI SDK）：

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://ai.example.com/v1",
  apiKey: "ccs_你的设备Token",
});

const res = await client.chat.completions.create({
  model: "my-claude-alias", // D1 中配置的 model_name 或 alias
  messages: [{ role: "user", content: "你好" }],
});
```

示例（Anthropic SDK）：

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://ai.example.com",
  apiKey: "ccs_你的设备Token",
});

const res = await client.messages.create({
  model: "my-gpt-alias",
  max_tokens: 1024,
  messages: [{ role: "user", content: "你好" }],
});
```

## D1 Schema

`migrations/0001_init.sql` 创建：

- `providers`：Provider 配置，`secret_name` 指向 Worker Secret。
- `models`：模型映射，`alias`/`model_name` 用于 Gateway 路由。
- `devices`：设备与 `token_hash`（只存 SHA-256，不存原始 Token）。
- `usage`：每次请求的用量与状态。
- `settings`：预留键值配置表。

时间统一使用 Unix 毫秒（UTC）。

## 安全与边界

- 单管理员：登录只依赖 `ADMIN_SECRET`，会话为无状态 HMAC 签名 Cookie，有效期 30 天，无会话撤销表。
- 设备 Token 仅在创建时返回一次，数据库只存 SHA-256 Hash；撤销后 Token 立即失效。
- Providers API 永不返回上游密钥，只返回 `secret_configured`。
- Gateway 请求体只被读取一次用于解析 `model`/`stream`，不持久化 prompt/response。
- 流式响应使用 TransformStream 透传，仅保留尾部约 16KB 用于流结束后解析 usage。
- V1 不包含多用户、fallback、限流、费用估算与 Gemini/Responses 协议，后续版本可扩展。
