import { useCallback, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, Empty, Spinner, CopyButton } from "../components/ui";
import { IconTerminal, IconShield, IconZap } from "../components/icons";
import { useQuery } from "../hooks/useQuery";

interface SettingsData {
  app_name: string;
  gateway_base_url: string;
  provider_count: number;
  providers: Array<{
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    secret_configured: boolean;
  }>;
}

export default function SettingsPage() {
  const fetchSettings = useCallback(async () => {
    return await api.get<SettingsData>("/api/settings");
  }, []);

  const { data, loading, error } = useQuery("settings-data", fetchSettings);
  const [activeTab, setActiveTab] = useState<"openai" | "anthropic" | "curl">("openai");

  if (loading && !data) return <Spinner text="正在加载系统设置…" />;
  if (error && !data) return <div className="text-xs text-rose-600 bg-rose-50 p-4 rounded-xl">{error.message}</div>;

  const baseUrl = data?.gateway_base_url || window.location.origin;

  const openaiCode = `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="YOUR_DEVICE_TOKEN"  # 在「设备 Token」页面签发的 Token
)

response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",  # 或你配置的别名
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

  const curlCode = `curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \\
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">系统设置与接入指引</h2>
        <p className="text-xs text-slate-500 mt-1">查看网关全局环境配置、服务商运行概览及客户端接入代码示例</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Gateway Meta */}
        <Card title="网关配置概览" className="lg:col-span-1">
          <dl className="space-y-3.5 text-xs">
            <div>
              <dt className="text-slate-400 font-medium">应用名称</dt>
              <dd className="font-semibold text-slate-800 mt-0.5">{data?.app_name || "AI Gateway"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-medium">Gateway Base URL</dt>
              <dd className="font-mono text-blue-700 bg-blue-50/60 p-2 rounded-lg break-all mt-1 flex items-center justify-between gap-1">
                <span>{baseUrl}</span>
                <CopyButton text={baseUrl} />
              </dd>
            </div>
            <div>
              <dt className="text-slate-400 font-medium">已配置 Provider 数量</dt>
              <dd className="font-semibold text-slate-800 mt-0.5">{data?.provider_count ?? 0} 个</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-medium">部署运行环境</dt>
              <dd className="text-slate-700 mt-0.5 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Cloudflare Workers & D1
              </dd>
            </div>
          </dl>
        </Card>

        {/* Provider Overview */}
        <Card title="Provider 运行状态" className="lg:col-span-2">
          {data?.providers?.length ? (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-medium">
                  <th className="pb-2.5 px-2">Provider</th>
                  <th className="pb-2.5 px-2">协议类型</th>
                  <th className="pb-2.5 px-2">服务状态</th>
                  <th className="pb-2.5 px-2">密钥状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.providers.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-2 font-medium text-slate-900">{p.name}</td>
                    <td className="py-2.5 px-2 text-slate-600 uppercase text-[11px]">{p.type}</td>
                    <td className="py-2.5 px-2">
                      <Badge tone={p.enabled ? "green" : "slate"} dot>
                        {p.enabled ? "启用" : "停用"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2">
                      <Badge tone={p.secret_configured ? "green" : "red"} dot>
                        {p.secret_configured ? "Secret 正常" : "缺少 Secret"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty text="暂无 Provider 配置" />
          )}
        </Card>
      </div>

      {/* Integration Code Examples */}
      <Card title="客户端接入指南 (SDK Code Snippets)">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <button
              onClick={() => setActiveTab("openai")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "openai" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              OpenAI SDK (Python)
            </button>
            <button
              onClick={() => setActiveTab("anthropic")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "anthropic" ? "bg-purple-50 text-purple-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Anthropic SDK (TypeScript)
            </button>
            <button
              onClick={() => setActiveTab("curl")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === "curl" ? "bg-slate-100 text-slate-800" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              cURL 请求
            </button>
          </div>

          <div className="relative rounded-xl bg-slate-900 p-4 text-xs font-mono text-slate-200 overflow-x-auto">
            <div className="absolute top-3 right-3">
              <CopyButton
                text={activeTab === "openai" ? openaiCode : activeTab === "anthropic" ? anthropicCode : curlCode}
                label="复制代码"
              />
            </div>
            <pre className="whitespace-pre overflow-x-auto leading-relaxed">
              {activeTab === "openai" ? openaiCode : activeTab === "anthropic" ? anthropicCode : curlCode}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
