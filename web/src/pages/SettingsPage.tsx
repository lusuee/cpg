import { useCallback, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, Empty, Spinner, CopyButton } from "../components/ui";
import { IconTerminal, IconShield, IconZap, IconTrash } from "../components/icons";
import { useQuery } from "../hooks/useQuery";

interface SettingsData {
  app_name: string;
  gateway_base_url: string;
  provider_count: number;
  cf_access_configured?: boolean;
  kv_cache_configured?: boolean;
  providers: Array<{
    id: string;
    name: string;
    type: string;
    enabled: boolean | number;
    api_key_configured?: boolean;
    secret_configured: boolean;
  }>;
}

export default function SettingsPage() {
  const fetchSettings = useCallback(async () => {
    return await api.get<SettingsData>("/api/settings");
  }, []);

  const { data, loading, error } = useQuery("settings-data", fetchSettings);
  const [activeTab, setActiveTab] = useState<"openai" | "anthropic" | "gemini" | "curl">("openai");
  const [purging, setPurging] = useState(false);

  const handlePurgeCache = async () => {
    if (!confirm("确定要清空所有网关缓存吗？此操作将重置内存与 KV 缓存。")) return;
    setPurging(true);
    try {
      const res = await api.post<{ ok: boolean; cleared: number }>("/api/cache/purge", {});
      alert(`网关缓存已清空，共清除 ${res.cleared ?? 0} 个缓存条目`);
    } catch (err: any) {
      alert(`清空缓存失败: ${err.message || "未知错误"}`);
    } finally {
      setPurging(false);
    }
  };

  if (loading && !data) return <Spinner text="正在加载系统设置…" />;
  if (error && !data) return <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-4 rounded-xl">{error.message}</div>;

  const baseUrl = data?.gateway_base_url || window.location.origin;

  const openaiCode = `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="YOUR_DEVICE_TOKEN"  # 在「设备 Token」页面签发的 Token
)

response = client.chat.completions.create(
    model="gpt-4o",  # 或你配置的模型别名
    messages=[{"role": "user", "content": "你好，请介绍一下你自己！"}]
)
print(response.choices[0].message.content)`;

  const anthropicCode = `import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  baseURL: "${baseUrl}",
  apiKey: "YOUR_DEVICE_TOKEN", // 在「设备 Token」页面签发的 Token
});

const message = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(message.content);`;

  const geminiCode = `import OpenAI from "openai";

// Gemini 在网关中支持通过标准 OpenAI 协议透明中转调用
const client = new OpenAI({
  baseURL: "${baseUrl}/v1",
  apiKey: "YOUR_DEVICE_TOKEN",
});

const res = await client.chat.completions.create({
  model: "gemini-1.5-pro", // 或绑定的 Gemini 别名
  messages: [{ role: "user", content: "Hello Gemini!" }],
});
console.log(res.choices[0].message.content);`;

  const curlCode = `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \\
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">系统设置与接入指引</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">查看网关全局环境配置、服务商运行概览及客户端接入代码示例</p>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Gateway Meta */}
        <Card title="网关配置概览" className="lg:col-span-1">
          <dl className="space-y-3.5 text-xs">
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">应用名称</dt>
              <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{data?.app_name || "AI Gateway"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">Gateway Base URL</dt>
              <dd className="font-mono text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/50 p-2 rounded-lg break-all mt-1 flex items-center justify-between gap-1">
                <span className="text-xs">{baseUrl}</span>
                <CopyButton text={baseUrl} />
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">已配置 Provider 数量</dt>
              <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{data?.provider_count ?? 0} 个</dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">Cloudflare Access 零信任</dt>
              <dd className="mt-0.5 flex items-center gap-1.5">
                <Badge tone={data?.cf_access_configured ? "green" : "slate"} dot>
                  {data?.cf_access_configured ? "已配置白名单" : "未开启（密码登录）"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">KV 响应缓存加速</dt>
              <dd className="mt-0.5 flex items-center gap-1.5">
                <Badge tone={data?.kv_cache_configured ? "green" : "blue"} dot>
                  {data?.kv_cache_configured ? "Cloudflare KV 已就绪" : "内存加速 / KV 可选"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500 font-medium">部署运行环境</dt>
              <dd className="text-slate-700 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Cloudflare Workers & D1
              </dd>
            </div>
          </dl>
        </Card>

        {/* Provider Overview */}
        <Card title="Provider 运行状态" className="lg:col-span-2">
          {data?.providers?.length ? (
            <div className="overflow-x-auto -mx-4 -my-4 sm:mx-0 sm:my-0">
              <table className="w-full text-left text-xs min-w-[420px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                    <th className="pb-2.5 px-3 whitespace-nowrap">Provider</th>
                    <th className="pb-2.5 px-2 whitespace-nowrap">协议类型</th>
                    <th className="pb-2.5 px-2 whitespace-nowrap">服务状态</th>
                    <th className="pb-2.5 px-3 whitespace-nowrap">密钥状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.providers.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{p.name}</td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400 uppercase text-[11px] whitespace-nowrap">{p.type}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <Badge tone={p.enabled ? "green" : "slate"} dot>
                          {p.enabled ? "启用" : "停用"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Badge tone={p.api_key_configured || p.secret_configured ? "green" : "red"} dot>
                          {p.api_key_configured || p.secret_configured ? "密钥正常" : "未配置密钥"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="暂无 Provider 配置" />
          )}
        </Card>
      </div>

      {/* Cache Acceleration & Maintenance */}
      <Card title="多级响应缓存优化 (Multi-Tier Caching)">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                L1 内存 LRU 缓存 + L2 Cloudflare KV 持久化
              </span>
              <Badge tone="green" dot>已启用</Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              高频重复请求优先命中内存（&lt;1ms 延迟），支持跨流式/非流式语义归一化复用，完整回放思考链与工具调用。
            </p>
          </div>
          <button
            onClick={handlePurgeCache}
            disabled={purging}
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm disabled:opacity-50 cursor-pointer shrink-0"
          >
            <IconTrash className="w-3.5 h-3.5 text-rose-500" />
            <span>{purging ? "正在清理…" : "一键清空网关缓存"}</span>
          </button>
        </div>
      </Card>

      {/* Integration Code Examples */}
      <Card title="客户端接入指南 (SDK Code Snippets)">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 overflow-x-auto whitespace-nowrap">
            <button
              onClick={() => setActiveTab("openai")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeTab === "openai" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              OpenAI SDK (Python)
            </button>
            <button
              onClick={() => setActiveTab("anthropic")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeTab === "anthropic" ? "bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Anthropic SDK (TypeScript)
            </button>
            <button
              onClick={() => setActiveTab("gemini")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeTab === "gemini" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Gemini (via Gateway)
            </button>
            <button
              onClick={() => setActiveTab("curl")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeTab === "curl" ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              cURL 请求
            </button>
          </div>

          <div className="rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-800 p-3.5 sm:p-4 text-xs font-mono text-slate-200">
            <div className="flex items-center justify-end mb-2">
              <CopyButton
                text={
                  activeTab === "openai"
                    ? openaiCode
                    : activeTab === "anthropic"
                    ? anthropicCode
                    : activeTab === "gemini"
                    ? geminiCode
                    : curlCode
                }
                label="复制代码"
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-xs"
              />
            </div>
            <pre className="whitespace-pre overflow-x-auto leading-relaxed">
              {activeTab === "openai"
                ? openaiCode
                : activeTab === "anthropic"
                ? anthropicCode
                : activeTab === "gemini"
                ? geminiCode
                : curlCode}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
