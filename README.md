# Cloudflare Personal AI Gateway (CPG)

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Workers_%26_D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare" />
  <img src="https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <b>完全运行在 Cloudflare 边缘网络上的现代化、高性能、轻量级个人 AI 网关与控制台。</b><br>
  单个 Worker 同时承载高性能 API 转发网关与现代化 React Web Dashboard，零服务器成本，毫秒级冷启动。
</p>

---

## 🌟 核心特性

- 🌐 **All-in-One 边缘原生架构**
  - **Worker + D1 + Static Assets**：无需自建服务器或 Docker，单个 Cloudflare Worker 同时托管 API 网关与 React Web 仪表盘。
  - **D1 分布式数据库**：持久化存储服务商、模型映射、设备 Token、实时用量及每日聚合数据。
- ⚡ **多协议支持与透明代理 (`/v1/*`)**
  - **OpenAI 兼容协议**：`/v1/chat/completions` 与 `/chat/completions`。
  - **Anthropic 协议**：`/v1/messages` 与 `/messages`。
  - **Google Gemini 支持**：原生 OpenAI 端点中转，支持 `usageMetadata` Token 解析。
  - **流式 (SSE) 与非流式透明透传**：毫秒级响应，流式尾部轻量解析 Token 消耗。
  - **模型别名映射 (Alias)**：支持设置快捷别名（如将 `gpt4` 映射到 `gpt-4o`，`claude` 映射到 `claude-3-5-sonnet-20241022`）。
  - **标准模型列表**：提供 `GET /v1/models`，无缝兼容 Codex、Cursor、Continue、Cherry Studio、NextChat 等客户端。
- 🔀 **高级路由与负载调度**
  - **直连模式 (Direct)**：单模型直接转发。
  - **多级降级链 (Fallback Chain)**：主模型遭遇 `5xx` 故障或 `429` 限流时，按列表自动依次降级重试备用模型。
  - **加权负载分流 (Weighted)**：按设定的权重比例分发流量，故障时自动调度到池内其他候选模型。
- 🔑 **多 Key 轮询与限流重试 (Multi-Key Pooling)**
  - 支持多账号/多密钥池化（逗号分隔 Secret 变量名或 JSON 配置密钥池）。
  - 自动打散请求；单个 Key 触发上游限流或配额耗尽时，自动换 Key 重试。
- 🛡️ **设备 Token 鉴权与零信任集成**
  - **设备隔离**：每台设备独立签发 `ccs_` 前缀 Token（数据库仅保存 SHA-256 哈希，一键撤销）。
  - **速率限制 (RPM)**：支持按设备配置每分钟请求上限（滑动窗口检测）。
  - **Cloudflare Access 零信任**：支持基于 `Cf-Access-Authenticated-User-Email` 白名单免密单点登录。
- 📊 **精细用量监控与多维统计分析**
  - **实时费用估算**：支持配置模型输入/输出 Token 单价（$/1M Tokens），精确记录每笔调用预估成本。
  - **延迟分位数统计**：支持 P50、P90、P99、Min、Max 延迟分位数分析。
  - **多维分析报表**：设备使用排行、HTTP 错误状态码分布统计。
  - **数据导出**：支持一键导出 CSV / JSON 格式用量明细文件。
- 🔄 **备份恢复与 CC Switch 互转**
  - **全量快照备份**：一键导出/导入包含全部配置的 JSON 快照（支持增量合并或完全覆盖）。
  - **CC Switch / OneAPI 双向导入导出**：无缝迁移现有规则与配置。
  - **自动化归档与日志清理**：每日定时 Cron 任务自动聚合历史数据，支持自定义保留天数（15/30/60/90 天）一键清理。

---

## 🏗️ 项目架构

```
.
├── worker/                     # Cloudflare Worker 后端 (Hono + TypeScript)
│   ├── migrations/             # D1 数据库 SQL 迁移文件 (0001_init, 0002_phase2, 0003_phase3)
│   ├── src/
│   │   ├── admin/              # 管理后台 API (/api/*)
│   │   ├── gateway/            # 网关路由、代理透传、多 Key 轮询、降级与 Token 解析
│   │   ├── middleware/         # Admin 会话鉴权与 Cloudflare Access 中间件
│   │   ├── db/                 # D1 数据库 Schema 与数据访问层 (repo.ts)
│   │   ├── utils/              # 加密、HTTP 头构建、辅助函数
│   │   └── index.ts            # Worker 入口与定时任务 (Cron) 处理器
│   ├── test/                   # Vitest 单元测试套件
│   └── wrangler.toml           # Cloudflare Worker 配置文件
├── web/                        # React SPA 管理后台前端
│   ├── src/
│   │   ├── pages/              # Dashboard/Providers/Models/Devices/Usage/Settings
│   │   ├── components/         # UI 基础组件库与图表
│   │   └── api/                # 前端 API 客户端封装
├── scripts/                    # 一键全自动部署与配置脚本 (deploy.mjs, prepare-config.mjs)
├── deploy.env.example          # 部署环境变量模板
└── pnpm-workspace.yaml         # pnpm monorepo 配置
```

---

## 🚀 快速开始与部署

### 1. 前置准备

- 安装 [Node.js](https://nodejs.org/) (>= 18.0.0) 和 [pnpm](https://pnpm.io/) (>= 9.0.0)。
- 登录 Cloudflare 账号：
  ```bash
  npx wrangler login
  ```

### 2. 本地开发调试

```bash
# 安装依赖
pnpm install

# 本地运行 Worker (监听 8787 端口)
pnpm dev:worker

# 在另一个终端启动前端 Vite 开发服务器 (自动代理 /api 和 /v1)
pnpm dev:web
```

---

## 🚢 一键全自动部署到 Cloudflare

本项目提供了全自动化的部署流程，自动完成 **前端构建 ➔ D1 数据库创建与绑定 ➔ 远程数据库迁移 ➔ 密钥注入 ➔ Worker 与静态资源部署**。

### 步骤 1：复制并填写部署配置文件

```bash
cp deploy.env.example deploy.env
```

编辑 `deploy.env` 文件（该文件已被 `.gitignore` 忽略，安全不泄露）：

```ini
# ==========================================
# 必填项：管理后台登录密码与会话密钥
# ==========================================
ADMIN_SECRET=你的管理后台密码
SESSION_SECRET=生成一个至少32位的随机安全字符串

# ==========================================
# 可选项：网关自定义域名与 D1 数据库
# ==========================================
# 展示在控制台的网关地址（默认为 https://ai.example.com，部署后可填入你的实际域名或 workers.dev 地址）
GATEWAY_BASE_URL=https://cpg.your-subdomain.workers.dev
APP_NAME=Personal AI Gateway

# D1 数据库 ID：留空即可！部署脚本会自动在你的 Cloudflare 账户下创建并绑定
# D1_DATABASE_ID=

# ==========================================
# 可选项：上游服务商 API Key（也可在部署后通过后台或 wrangler secret 配置）
# ==========================================
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...

# 多 Key 示例（支持逗号分隔多个 Secret 名称，或额外定义）
# OPENAI_API_KEY_1=sk-key-1
# OPENAI_API_KEY_2=sk-key-2
```

### 步骤 2：执行一键部署命令

```bash
pnpm deploy
```

> **自动化部署脚本执行步骤**：
> 1. 执行 `pnpm build:web` 构建前端单页应用至 `web/dist`。
> 2. 检查 Cloudflare 账户中的 D1 数据库，若不存在则自动创建 `personal-ai-gateway`，并将真实数据库 ID 自动写入 `worker/wrangler.toml`。
> 3. 自动将 `GATEWAY_BASE_URL` 和 `APP_NAME` 写入 `wrangler.toml` 的 `[vars]` 配置。
> 4. 自动对远程 D1 数据库执行全套 SQL Migration（初始化表结构、多 Provider 扩展、高级路由与分析表）。
> 5. 自动通过 `wrangler secret put` 上传所有已配置的密钥。
> 6. 部署 Worker 及静态资源资产，部署完成后输出可访问的公网 URL。

### 单独执行各环节命令

| 命令 | 说明 |
| --- | --- |
| `pnpm deploy` | **一键全自动部署**（前端构建 + D1 自动建库/迁移 + Secret 上传 + Worker 部署） |
| `pnpm deploy:worker` | 仅重新部署 Worker 代码（跳过前端构建和建库） |
| `pnpm build:web` | 仅编译打包前端 Web 仪表盘 |
| `pnpm db:migrate:remote` | 手动应用远程 Cloudflare D1 数据库迁移 |
| `pnpm db:migrate:local` | 本地开发环境 D1 数据库迁移 |
| `pnpm test` | 执行 Vitest 自动化单元测试 |
| `pnpm typecheck` | 执行全局 TypeScript 严格类型检查 |

---

## 💻 客户端接入示例

网关采用**透明智能路由机制**，客户端统一使用网关地址和设备 Token，通过请求体中的 `model` 自动分发至对应的上游服务商。

### 1. OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://cpg.your-subdomain.workers.dev/v1",
    api_key="ccs_your_device_token"  # 在「设备 Token」页面创建的密钥
)

response = client.chat.completions.create(
    model="gpt-4o",  # 或后台配置的别名如 "gpt4"
    messages=[{"role": "user", "content": "你好，请介绍一下你自己！"}]
)

print(response.choices[0].message.content)
```

### 2. Anthropic SDK (TypeScript)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://cpg.your-subdomain.workers.dev",
  apiKey: "ccs_your_device_token",
});

const message = await client.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello from Anthropic SDK!" }],
});

console.log(message.content);
```

### 3. Google Gemini (通过标准 OpenAI 协议)

```typescript
import OpenAI from "openai";

// Gemini 上游在网关中支持以标准 OpenAI 协议透明转发
const client = new OpenAI({
  baseURL: "https://cpg.your-subdomain.workers.dev/v1",
  apiKey: "ccs_your_device_token",
});

const response = await client.chat.completions.create({
  model: "gemini-1.5-pro",
  messages: [{ role: "user", content: "Hello Gemini!" }],
});

console.log(response.choices[0].message.content);
```

### 4. cURL 命令行

```bash
curl https://cpg.your-subdomain.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ccs_your_device_token" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### 5. 第三方客户端配置 (Cursor / Continue / NextChat / Cherry Studio)

- **API Base URL**：`https://你的网关域名/v1`
- **API Key**：`ccs_你的设备Token`
- **Model**：填入后台配置的模型名或别名

---

## 📡 API 路由总览

### 1. AI Gateway 代理接口 (`/v1/*` 或 `/*`)

| 方法 | 路径 | 说明 | 鉴权方式 |
| --- | --- | --- | --- |
| `POST` | `/v1/chat/completions` 或 `/chat/completions` | OpenAI / Gemini 格式对话补全（支持流式 SSE） | Device Bearer Token |
| `POST` | `/v1/messages` 或 `/messages` | Anthropic Messages 协议对话 | Device Bearer / `x-api-key` |
| `GET` | `/v1/models` 或 `/models` | 查询当前已启用的模型列表（OpenAI 标准格式） | Device Bearer Token |

### 2. 管理后台接口 (`/api/*`)

| 模块 | 方法与路径 | 说明 |
| --- | --- | --- |
| **Auth** | `POST /api/auth/login` | 管理员密码登录，写入 HttpOnly 会话 Cookie |
| | `POST /api/auth/logout` | 退出登录并清除 Cookie |
| | `GET /api/auth/me` | 检查当前登录状态 |
| **Providers** | `GET /api/providers` | 获取所有已配置的服务商 |
| | `POST /api/providers` | 创建服务商（支持 OpenAI、Anthropic、Gemini） |
| | `PUT /api/providers/:id` | 修改服务商配置 |
| | `DELETE /api/providers/:id` | 删除服务商 |
| | `POST /api/providers/:id/fetch-models` | 向上游实时探测可用模型列表 |
| **Models** | `GET /api/models` | 获取模型列表及关联信息 |
| | `POST /api/models` | 新增模型（支持定价、别名、降级与加权策略） |
| | `POST /api/models/batch` | 批量创建模型 |
| | `POST /api/models/batch-update` | 批量启用/停用模型 |
| | `POST /api/models/batch-delete` | 批量删除模型 |
| | `PUT /api/models/:id` | 更新模型配置 |
| | `DELETE /api/models/:id` | 删除模型 |
| **Devices** | `GET /api/devices` | 获取设备列表与 RPM 限流配置 |
| | `POST /api/devices` | 创建新设备 Token（原始 Token 仅返回一次） |
| | `PUT /api/devices/:id` | 更新设备名/启用状态/限流 RPM |
| | `POST /api/devices/:id/revoke` | 撤销设备 Token |
| **Usage** | `GET /api/usage` | 查询调用明细日志（支持分页与多条件筛选） |
| | `GET /api/usage/stats` | 仪表盘用量汇总、趋势与分布 |
| | `GET /api/usage/analytics` | 多维统计分析（P50/P90/P99 延迟分位数、设备排行、错误码分布） |
| | `GET /api/usage/export` | 导出用量数据为 CSV 或 JSON 格式文件 |
| | `POST /api/usage/cleanup` | 清理指定天数前的原始日志记录 |
| | `POST /api/usage/aggregate` | 手动触发每日用量数据聚合归档 |
| **Config** | `GET /api/config/export` | 导出全网关配置 JSON 快照 |
| | `POST /api/config/import` | 导入恢复全网关配置（支持 Merge / Overwrite） |
| | `GET /api/config/cc-switch` | 导出 CC Switch 标准格式配置 |
| | `POST /api/config/import-cc-switch` | 导入 CC Switch 格式配置 |
| **Settings**| `GET /api/settings` | 获取系统设置与各语言客户端接入代码 |

---

## 🔒 安全与设计边界

- **零明文密钥存储**：
  - 设备 Token 仅在生成时向管理员展示一次，D1 数据库中仅保存不可逆的 **SHA-256** 哈希值。
  - 上游服务商 API Key 统一保存在 Cloudflare Encrypted Secrets 中，管理 API 与前端页面绝不回显任何明文密钥。
- **高韧性流式透传**：
  - 网关直接基于 Web 标准 `TransformStream` 进行流式代理，不缓存在内存中，保持极低内存占用与低延迟。
  - 用量统计日志写入采用异步 `waitUntil` 执行，数据库写入异常绝不会影响上游模型响应返回给客户端。
- **访问控制**：
  - 管理端基于 HMAC-SHA256 签名 Cookie 认证；原生支持 Cloudflare Access 零信任白名单。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 或 Pull Request！


