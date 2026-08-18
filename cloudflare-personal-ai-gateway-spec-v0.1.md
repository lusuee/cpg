# Cloudflare 原生个人 AI Gateway / CC Switch 云端替代方案

**版本：v0.1 MVP**

**目标：配置中心 + API 中转 + 用量统计 + Web Dashboard**

**部署目标：Cloudflare Workers + D1 + Secrets**

------------------------------------------------------------------------

## 1. 项目概述

本项目旨在构建一个完全基于 Cloudflare 的个人 AI Gateway，替代当前通过 CC
Switch 在不同设备上分别维护 Provider 配置的方式。

系统提供：

-   Web 管理界面
-   API 中转入口
-   云端配置同步
-   用量统计
-   多设备访问

核心原则：

-   不依赖 VPS、Docker、PostgreSQL、Redis。
-   使用 Cloudflare Workers 作为 API Gateway 和后端 API。
-   使用 D1 保存非敏感配置、设备信息、用量及统计数据。
-   使用 Cloudflare Secrets 保存真实上游 API Key 等敏感凭据。
-   Web Dashboard 直接管理云端配置，不强依赖 CC Switch。
-   API 中转层尽量透明转发请求与流式响应。
-   第一版优先支持个人使用，不追求完整 SaaS、多租户和复杂计费。

------------------------------------------------------------------------

## 2. 目标与非目标

### 2.1 目标

1.  统一管理 Anthropic、OpenAI、Gemini 等 Provider。
2.  提供统一 API 域名，例如 `https://ai.example.com`。
3.  支持 OpenAI-compatible 与 Anthropic-compatible API。
4.  支持 Streaming / SSE。
5.  支持个人 API Token 鉴权。
6.  记录请求次数、模型、Provider、Token、延迟、HTTP 状态等用量信息。
7.  提供 Dashboard 查看今日、7 天、30 天用量。
8.  提供 Provider / Model 配置管理。
9.  支持多个设备使用不同 Token，并可单独撤销。

### 2.2 非目标

1.  第一版不实现完整 OAuth Provider 账号池。
2.  不实现复杂的多租户计费系统。
3.  不保存完整 Prompt / Response 内容。
4.  不直接修改或复刻 CC Switch 的本地数据库结构。
5.  不实现复杂的模型智能路由和自动套利。

------------------------------------------------------------------------

## 3. 总体架构

``` text
                    Cloudflare
                         │
              ┌──────────┴──────────┐
              │                     │
        Web Dashboard          API Gateway
              │                     │
              └──────────┬──────────┘
                         │
                    Cloudflare Worker
                  ┌──────┼──────────┐
                  │      │          │
                Auth   Config      Proxy
                  │      │          │
                  ▼      ▼          ▼
                 D1     D1       Upstream APIs
                  │                 ├─ Anthropic
                  │                 ├─ OpenAI
                  │                 └─ Gemini
                  │
              Usage / Stats

             Cloudflare Secrets
             ├─ ANTHROPIC_API_KEY
             ├─ OPENAI_API_KEY
             └─ GEMINI_API_KEY
```

------------------------------------------------------------------------

## 4. 技术栈

  层         技术
  ---------- ----------------------------------------
  Runtime    Cloudflare Workers
  Database   Cloudflare D1
  Secret     Cloudflare Workers Secrets
  Frontend   React + TypeScript + Vite
  UI         Tailwind CSS + 轻量组件库
  API        Worker 原生 fetch / Request / Response
  部署       Cloudflare Workers / Static Assets
  可选       Cron Triggers，用于日/月统计聚合

------------------------------------------------------------------------

## 5. 功能模块

### 5.1 Dashboard

提供：

-   今日请求数
-   今日输入 Token
-   今日输出 Token
-   今日总 Token
-   按 Provider 汇总
-   按 Model 汇总
-   平均延迟
-   失败请求数
-   最近请求列表
-   7 天 / 30 天趋势图

### 5.2 Provider 管理

-   新增、编辑、删除 Provider
-   启用/禁用 Provider
-   配置 Provider 类型
-   配置上游 Endpoint
-   关联 Secret 名称，而非向前端返回真实 API Key
-   配置默认模型

### 5.3 Model 管理

-   模型显示名
-   真实上游模型名
-   Provider 关联
-   启用/禁用
-   可选模型别名

### 5.4 Device / Token 管理

-   为家里、公司、笔记本等设备创建独立 Token
-   Token 只展示一次
-   数据库只保存 Token Hash
-   支持禁用/撤销
-   记录最后使用时间

### 5.5 Usage

记录：

-   请求时间
-   Provider
-   Model
-   Input Tokens
-   Output Tokens
-   Total Tokens
-   HTTP 状态
-   Latency
-   设备 / Token
-   Request ID

------------------------------------------------------------------------

## 6. API 设计

### 6.1 管理 API

``` text
GET    /api/health
POST   /api/auth/login

GET    /api/config
PUT    /api/config

GET    /api/providers
POST   /api/providers
PUT    /api/providers/:id
DELETE /api/providers/:id

GET    /api/models
POST   /api/models
PUT    /api/models/:id
DELETE /api/models/:id

GET    /api/devices
POST   /api/devices
DELETE /api/devices/:id

GET    /api/usage
GET    /api/stats
```

### 6.2 AI Gateway API

``` text
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/messages
```

实际支持的路径和协议应根据第一版选定的 Provider 确认。

V1 建议先实现 Anthropic Messages 和 OpenAI-compatible 接口，再逐步增加
Responses / Gemini。

------------------------------------------------------------------------

## 7. Proxy 流程

``` text
Client
  │
  │ Authorization: Bearer <gateway_token>
  ▼
Worker
  │
  ├─ 验证 Gateway Token
  ├─ 解析 URL / Model
  ├─ 查询 Provider / Model 配置
  ├─ 获取 Cloudflare Secret
  ├─ 构造上游请求
  ├─ fetch(upstream)
  ├─ 透明转发 Streaming Response
  │
  └─ 异步/低开销记录 Usage
       ↓
      D1
```

Proxy 不应默认保存完整请求 Body 和 Response
Body，以避免敏感数据泄露、数据库膨胀和额外成本。

------------------------------------------------------------------------

## 8. D1 数据模型

### 8.1 providers

``` sql
CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    endpoint TEXT,
    secret_name TEXT,
    enabled INTEGER DEFAULT 1,
    config_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
);
```

### 8.2 models

``` sql
CREATE TABLE models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    display_name TEXT,
    alias TEXT,
    enabled INTEGER DEFAULT 1,
    config_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
);
```

### 8.3 devices

``` sql
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_used_at INTEGER,
    created_at INTEGER,
    revoked_at INTEGER
);
```

### 8.4 usage

``` sql
CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    provider_id TEXT,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    status_code INTEGER,
    latency_ms INTEGER,
    request_id TEXT,
    created_at INTEGER
);
```

### 8.5 settings

``` sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT,
    updated_at INTEGER
);
```

------------------------------------------------------------------------

## 9. Secret 管理

真实 API Key 不进入 D1，不通过 Dashboard API 返回。

建议：

``` text
ANTHROPIC_API_KEY
OPENAI_API_KEY
GEMINI_API_KEY
ADMIN_SECRET / SESSION_SECRET
```

Provider 记录只保存 Secret 名称，例如：

``` text
ANTHROPIC_API_KEY
```

Worker 根据 `secret_name` 读取对应 Secret。

前端只能看到：

``` text
API Key: ••••••••••••
Status: Configured
```

------------------------------------------------------------------------

## 10. 认证与安全

### 管理端

管理 Dashboard 与 AI Gateway Token 分离。

推荐：

-   HttpOnly Cookie
-   Secure Cookie
-   SameSite Cookie
-   管理 API 必须要求管理员会话

### AI Gateway

每个设备拥有独立 Gateway Token：

``` http
Authorization: Bearer ccs_xxxxxxxxx
```

数据库只保存：

``` text
SHA-256(Token)
```

而不是原始 Token。

### 其他安全措施

-   禁止 API 返回真实上游 API Key。
-   生产环境强制 HTTPS。
-   可选 Cloudflare Access 保护 Dashboard。
-   可选增加速率限制。
-   可选增加异常请求检测。
-   敏感数据不写入普通日志。

------------------------------------------------------------------------

## 11. 用量统计策略

不同 Provider 的 Token 字段结构不同，因此 Worker 应针对 Provider
实现独立 usage parser，然后统一成：

``` text
input_tokens
output_tokens
total_tokens
```

例如：

``` text
Anthropic
    ↓
usage parser
    ↓
input_tokens / output_tokens / total_tokens
```

OpenAI 同理。

统计策略：

-   优先从 Provider Response 中解析 usage 字段。
-   无法获得 Token 时记录 NULL/0，同时保留请求次数与状态。
-   记录 `latency_ms` 与 `status_code`。
-   不保存完整 Prompt / Response。
-   Dashboard 默认按天、Provider、Model 聚合。
-   数据量增长后使用 Cron 将明细汇总到 `daily_usage` / `monthly_usage`。

------------------------------------------------------------------------

## 12. 前端页面

``` text
/login
/dashboard
/providers
/models
/devices
/usage
/settings
```

### Dashboard

-   总请求数
-   Token
-   预计费用
-   Provider 分布
-   Model 分布
-   最近请求
-   趋势图

### Providers

-   Provider CRUD
-   Endpoint
-   Secret 配置状态
-   默认模型
-   启用/禁用

### Models

-   Model CRUD
-   Provider
-   Alias
-   启用/禁用

### Devices

-   创建设备
-   创建 Token
-   撤销 Token
-   最后使用时间
-   在线/离线状态（可选）

### Usage

支持：

-   时间范围
-   Provider
-   Model
-   Device
-   请求数
-   Token
-   延迟
-   状态码

### Settings

-   Gateway 域名
-   默认配置
-   统计配置
-   系统设置

------------------------------------------------------------------------

## 13. 配置同步

第一版不需要让 CC Switch 参与同步。

**Web Dashboard 本身就是唯一配置源。**

客户端只需要使用统一的 Gateway Base URL 与设备 Token。

``` text
Cloud Config
    ↓
Dashboard 修改
    ↓
D1
    ↓
所有设备立即读取最新配置

AI Client
    ↓
统一 Gateway URL
    ↓
Worker
    ↓
D1 Provider/Model
    ↓
Upstream
```

未来如果仍需要 CC Switch，可以额外提供：

``` text
GET /api/config
```

作为兼容接口。

------------------------------------------------------------------------

## 14. Cloudflare 服务分工

  Cloudflare 服务                 用途
  ------------------------------- --------------------
  Workers                         API Gateway + 后端
  D1                              配置、设备、用量
  Secrets                         上游 API Key
  Workers Static Assets / Pages   Web 前端
  KV                              可选缓存
  Cron Triggers                   日/月统计聚合
  Analytics Engine                后续高量分析，可选

第一版只需要：

``` text
Workers + D1 + Secrets
```

------------------------------------------------------------------------

## 15. 第一版 MVP 范围

必须实现：

1.  管理员登录
2.  Dashboard 总览
3.  Provider 管理
4.  Model 管理
5.  设备 Token 管理
6.  Anthropic API Proxy
7.  OpenAI-compatible API Proxy
8.  Streaming / SSE
9.  D1 Usage 记录
10. 按日 / Provider / Model 的基本统计
11. Secrets 保存上游 API Key
12. Cloudflare 部署

建议 V1 只选择 1～2 个 Provider，先确保流式转发、鉴权和 Usage 记录稳定。

------------------------------------------------------------------------

## 16. 第二阶段

增加：

-   Gemini
-   OpenAI Responses API
-   模型别名
-   Fallback Provider
-   请求限流
-   费用估算
-   每日/月度统计聚合
-   Cloudflare Access
-   更完整的设备管理

------------------------------------------------------------------------

## 17. 第三阶段

增加：

-   多账号 Provider
-   Provider 路由策略
-   自动故障转移
-   高级用量分析
-   配置导入/导出
-   CC Switch 配置兼容
-   可选 OAuth Provider 管理

OAuth 只在明确需要时实现，不应作为 V1 的基础能力。

------------------------------------------------------------------------

## 18. 非功能要求

1.  Streaming 请求不能因为日志记录而阻塞响应。
2.  Proxy 尽量保持请求/响应透明。
3.  D1 写入失败不应导致已经成功获得的上游响应失败。
4.  敏感数据不写入普通日志。
5.  管理 API 与 AI API 权限隔离。
6.  所有数据库时间统一使用 Unix timestamp 或 UTC。
7.  前端适配桌面和移动端。
8.  Worker 应避免不必要的 CPU 计算。
9.  D1 查询应使用索引优化高频条件。
10. 统计写入应尽量降低对主请求链路的影响。

------------------------------------------------------------------------

## 19. 推荐项目目录

``` text
project/
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth/
│   │   ├── proxy/
│   │   │   ├── anthropic.ts
│   │   │   ├── openai.ts
│   │   │   └── usage.ts
│   │   ├── config/
│   │   ├── db/
│   │   └── utils/
│   ├── migrations/
│   └── wrangler.toml
│
├── web/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/
│   │   └── hooks/
│   └── vite.config.ts
│
└── README.md
```

------------------------------------------------------------------------

## 20. 最终产品定位

该项目不是 CC Switch 的桌面端复刻，而是一个 **Cloudflare 原生的个人 AI
Gateway**。

CC Switch 的 Provider 配置管理、API 中转和用量统计能力被拆分为：

-   **云端控制平面**
-   **API 数据平面**

用户只需要维护一个 Web 控制台，所有设备共享云端配置，并通过独立设备
Token 使用统一 API Gateway。

### 核心价值

-   一次配置，多设备使用
-   API Key 云端集中管理
-   统一 API 入口
-   实时/近实时用量统计
-   无需 VPS
-   无需维护 CC Switch 多份配置
-   可逐步扩展为完整个人 AI Gateway

------------------------------------------------------------------------

## 21. 推荐实施顺序

``` text
Phase 1
Cloudflare Worker
      ↓
Anthropic Proxy
      ↓
Streaming
      ↓
Gateway Token

Phase 2
D1
      ↓
Provider / Model
      ↓
Usage

Phase 3
Web Dashboard
      ↓
配置管理
      ↓
设备管理
      ↓
Usage Dashboard

Phase 4
OpenAI
      ↓
Gemini
      ↓
更多 Provider

Phase 5
Fallback
      ↓
限流
      ↓
费用统计
      ↓
高级路由
```

**最终目标：**

``` text
                 Web Dashboard
                       │
                       ▼
                 Cloudflare Worker
                 ┌─────┼─────┐
                 │     │     │
               Auth  Config Proxy
                 │     │     │
                 ▼     ▼     ▼
                D1    D1   Upstream
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
              Claude      OpenAI    Gemini

          Home ───────────────┐
          Office ─────────────┼──→ Gateway
          Laptop ─────────────┘
```

这个架构就是 **Cloudflare 原生个人版 CC Switch / AI Gateway**。
