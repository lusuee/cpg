import { useCallback, useState, useEffect } from "react";
import { api } from "../api/client";
import type { BudgetConfigResponse, WebhookConfigResponse } from "../types";
import { Badge, Card, Empty, Spinner, CopyButton, Button, Input, Select } from "../components/ui";
import { IconTerminal, IconShield, IconZap, IconTrash } from "../components/icons";
import { useToast } from "../components/Toast";
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
  const toast = useToast();
  const fetchSettings = useCallback(async () => {
    return await api.get<SettingsData>("/api/settings");
  }, []);

  const { data, loading, error } = useQuery("settings-data", fetchSettings);
  const [activeTab, setActiveTab] = useState<"openai" | "anthropic" | "gemini" | "curl">("openai");
  const [purging, setPurging] = useState(false);

  // Budget State
  const [budgetForm, setBudgetForm] = useState({
    monthly_budget_usd: 0,
    budget_action: "warn" as "warn" | "block",
    alert_threshold_pct: 80,
    spent_this_month_usd: 0,
  });
  const [savingBudget, setSavingBudget] = useState(false);

  // Webhook State
  const [webhookForm, setWebhookForm] = useState({
    url: "",
    secret: "",
    events: ["budget_exceeded", "provider_error"],
  });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const fetchBudget = useCallback(async () => {
    return await api.get<BudgetConfigResponse>("/api/settings/budget");
  }, []);

  const fetchWebhook = useCallback(async () => {
    return await api.get<WebhookConfigResponse>("/api/settings/webhook");
  }, []);

  const { data: budgetData, refresh: refreshBudget } = useQuery("budget-data", fetchBudget);
  const { data: webhookData, refresh: refreshWebhook } = useQuery("webhook-data", fetchWebhook);

  useEffect(() => {
    if (budgetData) {
      setBudgetForm({
        monthly_budget_usd: budgetData.monthly_budget_usd || 0,
        budget_action: budgetData.budget_action || "warn",
        alert_threshold_pct: budgetData.alert_threshold_pct || 80,
        spent_this_month_usd: budgetData.spent_this_month_usd || 0,
      });
    }
  }, [budgetData]);

  useEffect(() => {
    if (webhookData) {
      setWebhookForm((prev) => ({
        ...prev,
        url: webhookData.url || "",
        events: webhookData.events || ["budget_exceeded", "provider_error"],
      }));
    }
  }, [webhookData]);

  const handlePurgeCache = async () => {
    if (!confirm("确定要清空所有网关缓存吗？此操作将重置内存与 KV 缓存。")) return;
    setPurging(true);
    try {
      const res = await api.post<{ ok: boolean; cleared: number }>("/api/cache/purge", {});
      toast.success(`网关缓存已清空，共清除 ${res.cleared ?? 0} 个缓存条目`);
    } catch (err: any) {
      toast.error(`清空缓存失败: ${err.message || "未知错误"}`);
    } finally {
      setPurging(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBudget(true);
    try {
      await api.put("/api/settings/budget", {
        monthly_budget_usd: Number(budgetForm.monthly_budget_usd) || 0,
        budget_action: budgetForm.budget_action,
        alert_threshold_pct: Number(budgetForm.alert_threshold_pct) || 80,
      });
      toast.success("月度预算配置已保存");
      await refreshBudget();
    } catch (err: any) {
      toast.error(`保存预算失败: ${err.message || "未知错误"}`);
    } finally {
      setSavingBudget(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWebhook(true);
    try {
      await api.put("/api/settings/webhook", {
        url: webhookForm.url,
        secret: webhookForm.secret || undefined,
        events: webhookForm.events,
      });
      toast.success("Webhook 告警配置已保存");
      await refreshWebhook();
    } catch (err: any) {
      toast.error(`保存 Webhook 失败: ${err.message || "未知错误"}`);
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    if (!webhookForm.url && !webhookData?.url) {
      toast.error("请先输入 Webhook 目标 URL");
      return;
    }
    setTestingWebhook(true);
    try {
      const res = await api.post<{ ok: boolean; status?: number; error?: string }>("/api/settings/test-webhook", {
        url: webhookForm.url || undefined,
        secret: webhookForm.secret || undefined,
      });
      if (res.ok) {
        toast.success(`测试消息已成功发送至 Webhook (HTTP ${res.status || 200})`);
      } else {
        toast.error(`测试发送失败: ${res.error || "未知异常"}`);
      }
    } catch (err: any) {
      toast.error(`发送失败: ${err.message || "网络请求超时"}`);
    } finally {
      setTestingWebhook(false);
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
  messages: [{ role: "user", content: "你好！" }],
});
console.log(message.content);`;

  const geminiCode = `curl "${baseUrl}/v1/chat/completions" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  const curlCode = `curl "${baseUrl}/v1/models" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN"`;

  const budgetUsagePercent = budgetForm.monthly_budget_usd > 0
    ? Math.min(100, Math.round((budgetForm.spent_this_month_usd / budgetForm.monthly_budget_usd) * 100))
    : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">系统设置与配额</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          网关基础环境、月度预算配额控制、自动化 Webhook 告警与多级缓存维护
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card title="网关基础信息">
          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">应用名称</dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100">{data?.app_name}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">已接入 Provider</dt>
              <dd className="font-mono text-slate-900 dark:text-slate-100 font-semibold">{data?.provider_count} 个</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Cloudflare Access</dt>
              <dd>
                <Badge tone={data?.cf_access_configured ? "green" : "slate"}>
                  {data?.cf_access_configured ? "已配置白名单" : "未开启"}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">KV 响应缓存</dt>
              <dd>
                <Badge tone={data?.kv_cache_configured ? "green" : "slate"}>
                  {data?.kv_cache_configured ? "CACHE_KV 已绑定" : "内存 LRU"}
                </Badge>
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

      {/* Feature 4: Monthly Budget & Quota Control Card */}
      <Card title="💰 月度预算配额与超额控制 (Monthly Budget)">
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                月度总预算上限 (USD $)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0 为不限制"
                value={budgetForm.monthly_budget_usd || ""}
                onChange={(e) => setBudgetForm({ ...budgetForm, monthly_budget_usd: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-[11px] text-slate-400 mt-1">设为 0 表示不设预算上限</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                超额处理策略
              </label>
              <Select
                value={budgetForm.budget_action}
                onChange={(e) => setBudgetForm({ ...budgetForm, budget_action: e.target.value as any })}
              >
                <option value="warn">⚠️ 仅发 Webhook 告警 (不阻断请求)</option>
                <option value="block">🚫 自动熔断拦截 (超额返回 429 停止扣费)</option>
              </Select>
              <p className="text-[11px] text-slate-400 mt-1">预算用尽时网关执行的操作</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                预警百分比阈值 (%)
              </label>
              <Input
                type="number"
                min="10"
                max="99"
                value={budgetForm.alert_threshold_pct}
                onChange={(e) => setBudgetForm({ ...budgetForm, alert_threshold_pct: parseInt(e.target.value, 10) || 80 })}
              />
              <p className="text-[11px] text-slate-400 mt-1">达到该百分比自动发送 Webhook 提醒</p>
            </div>
          </div>

          {/* Month Spend Progress Bar */}
          {budgetForm.monthly_budget_usd > 0 && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-600 dark:text-slate-300">
                  本月累计消耗: <strong className="text-slate-900 dark:text-slate-100 font-mono">${budgetForm.spent_this_month_usd.toFixed(2)}</strong> / ${budgetForm.monthly_budget_usd.toFixed(2)}
                </span>
                <span className={`font-mono font-bold ${budgetUsagePercent >= 100 ? "text-rose-600" : budgetUsagePercent >= 80 ? "text-amber-600" : "text-emerald-600"}`}>
                  {budgetUsagePercent}%
                </span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    budgetUsagePercent >= 100 ? "bg-rose-500" : budgetUsagePercent >= 80 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${budgetUsagePercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" type="submit" disabled={savingBudget} className="shadow-xs">
              {savingBudget ? "正在保存…" : "保存预算策略"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Feature 5: Webhook Notifications Card */}
      <Card title="🔔 Webhook 告警与通知 (Alert Notifications)">
        <form onSubmit={handleSaveWebhook} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Webhook 目标 URL
              </label>
              <Input
                type="url"
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
                value={webhookForm.url}
                onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                支持<strong>飞书、钉钉、企业微信、Slack、Discord</strong>及自定义 Webhook
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Secret 签名密钥 (可选)
              </label>
              <Input
                type="password"
                placeholder={webhookData?.secret_configured ? "已配置 (留空保持不变)" : "可选 HMAC 签名 Token"}
                value={webhookForm.secret}
                onChange={(e) => setWebhookForm({ ...webhookForm, secret: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">用于请求头 X-Webhook-Secret 校验</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              触发通知的事件类型
            </label>
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={webhookForm.events.includes("budget_exceeded")}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...webhookForm.events, "budget_exceeded"]
                      : webhookForm.events.filter((ev) => ev !== "budget_exceeded");
                    setWebhookForm({ ...webhookForm, events: next });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>月度预算超额 / 达到预警阈值</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={webhookForm.events.includes("provider_error")}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...webhookForm.events, "provider_error"]
                      : webhookForm.events.filter((ev) => ev !== "provider_error");
                    setWebhookForm({ ...webhookForm, events: next });
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>上游服务商 5xx 故障与降级失败</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestWebhook}
              disabled={testingWebhook || !webhookForm.url}
              className="text-xs"
            >
              {testingWebhook ? "正在测试…" : "🧪 测试发送消息"}
            </Button>

            <Button size="sm" type="submit" disabled={savingWebhook} className="shadow-xs">
              {savingWebhook ? "正在保存…" : "保存 Webhook 配置"}
            </Button>
          </div>
        </form>
      </Card>

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
