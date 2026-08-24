import { useCallback, useState, useEffect } from "react";
import { api, fmtTime } from "../api/client";
import type {
  BudgetConfigResponse,
  WebhookConfigResponse,
  IpWhitelistConfig,
  KeyRotationReport,
  ConfigSnapshotItem,
  AuditLogItem,
} from "../types";
import { Badge, Card, Empty, Spinner, CopyButton, Button, Input, Select } from "../components/ui";
import {
  IconTerminal,
  IconShield,
  IconZap,
  IconTrash,
  IconDownload,
  IconRefresh,
  IconKey,
  IconFileText,
  IconCamera,
  IconHistory,
  IconAlertTriangle,
} from "../components/icons";
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

  const [activeSnippetTab, setActiveSnippetTab] = useState<"openai" | "anthropic" | "gemini" | "curl">("openai");
  const [purging, setPurging] = useState(false);

  // 1. Budget State
  const [budgetForm, setBudgetForm] = useState({
    monthly_budget_usd: 0,
    budget_action: "warn" as "warn" | "block",
    alert_threshold_pct: 80,
    spent_this_month_usd: 0,
  });
  const [savingBudget, setSavingBudget] = useState(false);

  // 2. Webhook State
  const [webhookForm, setWebhookForm] = useState({
    url: "",
    secret: "",
    events: ["budget_exceeded", "provider_error"],
  });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // 3. IP Whitelist State
  const [ipForm, setIpForm] = useState<IpWhitelistConfig>({
    enabled: false,
    allowed_ips: [],
    client_ip: "",
  });
  const [newIpInput, setNewIpInput] = useState("");
  const [savingIp, setSavingIp] = useState(false);

  // 4. Key Rotation State
  const [keyRotationData, setKeyRotationData] = useState<KeyRotationReport | null>(null);
  const [loadingKeyRotation, setLoadingKeyRotation] = useState(false);
  const [rotatingProviderId, setRotatingProviderId] = useState<string | null>(null);
  const [newKeyInput, setNewKeyInput] = useState("");

  // 5. Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);

  // 6. Snapshots State
  const [snapshots, setSnapshots] = useState<ConfigSnapshotItem[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotDesc, setSnapshotDesc] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<any | null>(null);

  // Fetch helpers
  const fetchBudget = useCallback(async () => {
    return await api.get<BudgetConfigResponse>("/api/settings/budget");
  }, []);
  const fetchWebhook = useCallback(async () => {
    return await api.get<WebhookConfigResponse>("/api/settings/webhook");
  }, []);

  const { data: budgetData, refresh: refreshBudget } = useQuery("budget-data", fetchBudget);
  const { data: webhookData, refresh: refreshWebhook } = useQuery("webhook-data", fetchWebhook);

  const loadIpWhitelist = useCallback(async () => {
    try {
      const res = await api.get<IpWhitelistConfig>("/api/settings/ip-whitelist");
      setIpForm(res);
    } catch {}
  }, []);

  const loadKeyRotation = useCallback(async () => {
    setLoadingKeyRotation(true);
    try {
      const res = await api.get<KeyRotationReport>("/api/settings/key-rotation?days=90");
      setKeyRotationData(res);
    } catch {}
    finally {
      setLoadingKeyRotation(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await api.get<{ items: AuditLogItem[]; total: number }>("/api/audit-logs?limit=30");
      setAuditLogs(res.items || []);
      setAuditTotal(res.total || 0);
    } catch {}
    finally {
      setLoadingAudit(false);
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    try {
      const res = await api.get<{ items: ConfigSnapshotItem[] }>("/api/settings/snapshots");
      setSnapshots(res.items || []);
    } catch {}
    finally {
      setLoadingSnapshots(false);
    }
  }, []);

  useEffect(() => {
    loadIpWhitelist();
    loadKeyRotation();
    loadAuditLogs();
    loadSnapshots();
  }, [loadIpWhitelist, loadKeyRotation, loadAuditLogs, loadSnapshots]);

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
      loadAuditLogs();
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
      loadAuditLogs();
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

  const handleSaveIpWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIp(true);
    try {
      const res = await api.put<IpWhitelistConfig>("/api/settings/ip-whitelist", {
        enabled: ipForm.enabled,
        allowed_ips: ipForm.allowed_ips,
      });
      setIpForm(res);
      toast.success("IP 白名单控制已保存");
      loadAuditLogs();
    } catch (err: any) {
      toast.error(err.message || "保存 IP 白名单失败");
    } finally {
      setSavingIp(false);
    }
  };

  const handleAddIp = () => {
    const ip = newIpInput.trim();
    if (!ip) return;
    if (ipForm.allowed_ips.includes(ip)) {
      toast.error("该 IP 或网段已存在于列表中");
      return;
    }
    setIpForm({ ...ipForm, allowed_ips: [...ipForm.allowed_ips, ip] });
    setNewIpInput("");
  };

  const handleAddCurrentIp = () => {
    if (ipForm.client_ip && !ipForm.allowed_ips.includes(ipForm.client_ip)) {
      setIpForm({ ...ipForm, allowed_ips: [...ipForm.allowed_ips, ipForm.client_ip] });
      toast.success(`已添加当前客户端 IP: ${ipForm.client_ip}`);
    }
  };

  const handleRemoveIp = (ipToRemove: string) => {
    setIpForm({
      ...ipForm,
      allowed_ips: ipForm.allowed_ips.filter((ip) => ip !== ipToRemove),
    });
  };

  const handleRotateKeySubmit = async (providerId: string) => {
    if (!newKeyInput.trim()) {
      toast.error("请输入新的 API Key");
      return;
    }
    try {
      await api.post(`/api/providers/${providerId}/rotate-key`, {
        api_key: newKeyInput.trim(),
      });
      toast.success("Provider API Key 已成功轮换");
      setRotatingProviderId(null);
      setNewKeyInput("");
      loadKeyRotation();
      loadAuditLogs();
    } catch (err: any) {
      toast.error(err.message || "轮换 Key 失败");
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSnapshot(true);
    try {
      await api.post("/api/settings/snapshots", {
        name: snapshotName.trim() || undefined,
        description: snapshotDesc.trim() || undefined,
      });
      toast.success("配置快照已成功创建");
      setShowCreateModal(false);
      setSnapshotName("");
      setSnapshotDesc("");
      loadSnapshots();
      loadAuditLogs();
    } catch (err: any) {
      toast.error(err.message || "创建快照失败");
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRollbackSnapshot = async (id: string, name: string) => {
    if (!confirm(`⚠️ 确定要将系统配置回滚至快照「${name}」吗？\n\n回滚前系统将自动生成一份当前配置的安全备份快照。`)) return;
    try {
      const res = await api.post<{ success: boolean; message: string }>(`/api/settings/snapshots/${id}/rollback`, {});
      toast.success(res.message || "系统配置已成功回滚");
      loadSnapshots();
      loadAuditLogs();
    } catch (err: any) {
      toast.error(err.message || "回滚快照失败");
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    if (!confirm("确定要删除此快照吗？")) return;
    try {
      await api.del(`/api/settings/snapshots/${id}`);
      toast.success("快照已删除");
      loadSnapshots();
      loadAuditLogs();
    } catch (err: any) {
      toast.error(err.message || "删除快照失败");
    }
  };

  const handlePurgeCache = async () => {
    if (!confirm("确定要清空所有网关缓存吗？此操作将重置内存与 KV 缓存。")) return;
    setPurging(true);
    try {
      const res = await api.post<{ ok: boolean; cleared: number }>("/api/cache/purge", {});
      toast.success(`网关缓存已清空，共清除 ${res.cleared ?? 0} 个缓存条目`);
      loadAuditLogs();
    } catch (err: any) {
      toast.error(`清空缓存失败: ${err.message || "未知错误"}`);
    } finally {
      setPurging(false);
    }
  };

  const handleExportAuditLogs = async () => {
    setExportingAudit(true);
    try {
      await api.download("/api/audit-logs/export", `audit-logs-${Date.now()}.csv`);
      toast.success("审计日志 CSV 导出成功");
    } catch (err: any) {
      toast.error(err.message || "导出审计日志失败");
    } finally {
      setExportingAudit(false);
    }
  };

  if (loading && !data) return <Spinner text="正在加载系统设置…" />;
  if (error && !data) return <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-4 rounded-xl">{error.message}</div>;

  const baseUrl = data?.gateway_base_url || window.location.origin;

  const openaiCode = `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="YOUR_DEVICE_TOKEN" # 在设备管理中创建的 Device Token
)

response = client.chat.completions.create(
    model="gpt-4o", # 或使用自定义别名
    messages=[{"role": "user", "content": "Hello via CPG Gateway!"}]
)
print(response.choices[0].message.content)`;

  const anthropicCode = `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${baseUrl}",
  apiKey: "YOUR_DEVICE_TOKEN",
});

const message = await client.messages.create({
  model: "claude-3-5-sonnet",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello from TypeScript!" }],
});
console.log(message.content);`;

  const geminiCode = `curl "${baseUrl}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \\
  -d '{
    "model": "gemini-1.5-pro",
    "messages": [{"role": "user", "content": "Hello Gemini!"}]
  }'`;

  const curlCode = `curl -X POST "${baseUrl}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Ping"}],
    "stream": false
  }'`;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          系统设置与安全控制中心
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          管理 IP 白名单、API Key 轮转、审计日志、OpenAPI 规范文档与配置快照回滚
        </p>
      </div>

      {/* 1. IP Whitelist & Access Control */}
      <Card title="🛡️ IP 白名单与管理后台访问控制 (IP Whitelist)">
        <form onSubmit={handleSaveIpWhitelist} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                限制 Admin 管理后台仅允许特定 IP / CIDR 网段访问
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                开启后，所有非白名单 IP 尝试访问管理后台 API 时将被直接拦截 (HTTP 403)
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={ipForm.enabled}
                onChange={(e) => setIpForm({ ...ipForm, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                允许的 IP / CIDR 网段列表
              </label>
              {ipForm.client_ip && (
                <button
                  type="button"
                  onClick={handleAddCurrentIp}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <span>📍 添加当前 IP ({ipForm.client_ip})</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="例如: 192.168.1.100 或 10.0.0.0/24"
                value={newIpInput}
                onChange={(e) => setNewIpInput(e.target.value)}
                className="text-xs font-mono"
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddIp}>
                添加 IP
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-2">
              {ipForm.allowed_ips.length > 0 ? (
                ipForm.allowed_ips.map((ip) => (
                  <span
                    key={ip}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-xs border border-slate-200/80 dark:border-slate-700/80"
                  >
                    <span>{ip}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveIp(ip)}
                      className="text-slate-400 hover:text-rose-500 transition-colors ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic">尚未配置任何 IP（白名单为空）</span>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button size="sm" type="submit" disabled={savingIp}>
              {savingIp ? "保存中…" : "保存 IP 白名单配置"}
            </Button>
          </div>
        </form>
      </Card>

      {/* 2. API Key Rotation & Aging */}
      <Card title="🔑 API Key 轮转与生命周期追踪 (Key Lifecycle & Aging)">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              基于安全合规建议，定期轮换上游服务商 API Key 与设备 Token（推荐 90 天周期）
            </p>
            <Button variant="outline" size="sm" onClick={() => loadKeyRotation()} disabled={loadingKeyRotation}>
              <IconRefresh />
              <span>刷新密钥状态</span>
            </Button>
          </div>

          {loadingKeyRotation ? (
            <Spinner text="正在检查密钥生命周期…" />
          ) : keyRotationData ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                  <div className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">健康正常 (&lt;60 天)</div>
                  <div className="text-xl font-bold text-emerald-900 dark:text-emerald-100 mt-0.5">
                    {keyRotationData.fresh_count} <span className="text-xs font-normal">个密钥</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                  <div className="text-xs text-amber-700 dark:text-amber-300 font-medium">接近轮转期 (60~90 天)</div>
                  <div className="text-xl font-bold text-amber-900 dark:text-amber-100 mt-0.5">
                    {keyRotationData.expiring_soon_count} <span className="text-xs font-normal">个密钥</span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
                  <div className="text-xs text-rose-700 dark:text-rose-300 font-medium">超期建议轮转 (&gt;90 天)</div>
                  <div className="text-xl font-bold text-rose-900 dark:text-rose-100 mt-0.5">
                    {keyRotationData.expired_count} <span className="text-xs font-normal">个密钥</span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto -mx-4 -my-2 sm:mx-0 sm:my-0">
                <table className="w-full text-left text-xs min-w-[620px]">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-medium">
                      <th className="pb-2.5 px-3">名称 / 对象</th>
                      <th className="pb-2.5 px-2">类型</th>
                      <th className="pb-2.5 px-2">已使用天数</th>
                      <th className="pb-2.5 px-2">安全状态</th>
                      <th className="pb-2.5 px-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {keyRotationData.items.map((item) => (
                      <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          {item.name}
                        </td>
                        <td className="py-2.5 px-2 font-mono text-slate-500">
                          {item.type === "provider" ? "Provider Key" : "Device Token"}
                        </td>
                        <td className="py-2.5 px-2 font-mono font-medium text-slate-700 dark:text-slate-300">
                          {item.age_days} 天
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge
                            tone={
                              item.status === "expired"
                                ? "red"
                                : item.status === "expiring_soon"
                                ? "amber"
                                : "green"
                            }
                            dot
                          >
                            {item.status === "expired"
                              ? "建议立即轮换"
                              : item.status === "expiring_soon"
                              ? "近期计划轮换"
                              : "状态良好"}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {item.type === "provider" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRotatingProviderId(item.id);
                                setNewKeyInput("");
                              }}
                            >
                              一键轮换
                            </Button>
                          ) : (
                            <span className="text-[11px] text-slate-400">在设备管理中撤销重签</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty text="暂无密钥轮转信息" />
          )}

          {/* Inline Rotate Key Modal */}
          {rotatingProviderId && (
            <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 space-y-3">
              <div className="text-xs font-bold text-blue-900 dark:text-blue-200">
                🔑 输入新的 API Key 立即替换
              </div>
              <Input
                type="password"
                placeholder="sk-..."
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                className="text-xs font-mono"
              />
              <div className="flex items-center gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setRotatingProviderId(null)}>
                  取消
                </Button>
                <Button size="sm" onClick={() => handleRotateKeySubmit(rotatingProviderId)}>
                  确认替换
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 3. Audit Logs */}
      <Card title="📜 管理员操作审计日志 (Audit Trail)">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              记录所有对 Provider、Model、Device、系统配置与快照的写操作（累计 {auditTotal} 条）
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportAuditLogs} disabled={exportingAudit || auditLogs.length === 0}>
                <IconDownload />
                <span>{exportingAudit ? "导出中…" : "导出审计 CSV"}</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadAuditLogs()}>
                <IconRefresh />
                <span>刷新</span>
              </Button>
            </div>
          </div>

          {loadingAudit ? (
            <Spinner text="正在获取审计日志…" />
          ) : auditLogs.length > 0 ? (
            <div className="overflow-x-auto -mx-4 -my-2 sm:mx-0 sm:my-0">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-medium">
                    <th className="pb-2.5 px-3">时间</th>
                    <th className="pb-2.5 px-2">动作</th>
                    <th className="pb-2.5 px-2">对象类型</th>
                    <th className="pb-2.5 px-2">描述摘要</th>
                    <th className="pb-2.5 px-3 text-right">客户端 IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500">
                        {fmtTime(log.created_at)}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <Badge
                          tone={
                            log.action.includes("delete") || log.action.includes("rollback")
                              ? "red"
                              : log.action.includes("create")
                              ? "green"
                              : "blue"
                          }
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-600 dark:text-slate-400">
                        {log.target_type}
                      </td>
                      <td className="py-2.5 px-2 font-medium text-slate-900 dark:text-slate-100">
                        {log.summary}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500 whitespace-nowrap">
                        {log.ip || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="暂无审计操作日志记录" />
          )}
        </div>
      </Card>

      {/* 4. OpenAPI 3.0 Documentation & Export */}
      <Card title="📑 OpenAPI 3.0 规范文档与开发工具集成 (OpenAPI Spec)">
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            网关已自动基于您当前启用的模型与服务商，动态生成完整的 OpenAPI 3.0.3 标准规范。可直接导入 Postman、Swagger UI、Scalar、Apifox 或 API 调试客户端。
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={`${baseUrl}/v1/openapi.json`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 hover:bg-blue-100 transition-colors"
            >
              <IconFileText />
              <span>查看 openapi.json</span>
            </a>
            <CopyButton
              text={`${baseUrl}/v1/openapi.json`}
              label="复制 OpenAPI 链接"
              className="border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg text-xs"
            />
          </div>
        </div>
      </Card>

      {/* 5. Config Snapshots & Diff Rollback */}
      <Card title="📸 配置版本快照与历史回滚 (Config Snapshots & Rollback)">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              对全局 Provider、Model 规则与系统设置创建快照备份，支持一键安全恢复回滚
            </p>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <IconCamera />
              <span>创建配置快照</span>
            </Button>
          </div>

          {loadingSnapshots ? (
            <Spinner text="正在获取快照列表…" />
          ) : snapshots.length > 0 ? (
            <div className="overflow-x-auto -mx-4 -my-2 sm:mx-0 sm:my-0">
              <table className="w-full text-left text-xs min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-medium">
                    <th className="pb-2.5 px-3">快照名称</th>
                    <th className="pb-2.5 px-2">描述</th>
                    <th className="pb-2.5 px-2">创建时间</th>
                    <th className="pb-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {snapshots.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        {s.name}
                      </td>
                      <td className="py-2.5 px-2 text-slate-500 max-w-[220px] truncate">
                        {s.description || "-"}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-slate-500">
                        {fmtTime(s.created_at)}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRollbackSnapshot(s.id, s.name)}
                            title="恢复并回滚至此版本"
                          >
                            ⏪ 回滚
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteSnapshot(s.id)}
                            className="text-rose-600 hover:text-rose-700"
                          >
                            <IconTrash />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="尚未创建任何配置快照" />
          )}

          {/* Create Snapshot Modal */}
          {showCreateModal && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">📸 创建新的系统配置快照</h4>
              <Input
                placeholder="快照名称 (如: 升级 DeepSeek 路由前的备份)"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                className="text-xs"
              />
              <Input
                placeholder="快照备注描述 (可选)"
                value={snapshotDesc}
                onChange={(e) => setSnapshotDesc(e.target.value)}
                className="text-xs"
              />
              <div className="flex items-center gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                  取消
                </Button>
                <Button size="sm" onClick={handleCreateSnapshot} disabled={creatingSnapshot}>
                  {creatingSnapshot ? "保存中…" : "立即保存快照"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 6. Budget & Quota Controls */}
      <Card title="💰 月度预算与超额熔断 (Budget & Quota Limits)">
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                月度费用预算 ($ USD)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={budgetForm.monthly_budget_usd}
                onChange={(e) => setBudgetForm({ ...budgetForm, monthly_budget_usd: parseFloat(e.target.value) || 0 })}
                placeholder="0 为不限制"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                超额触发动作
              </label>
              <Select
                value={budgetForm.budget_action}
                onChange={(e) => setBudgetForm({ ...budgetForm, budget_action: e.target.value as "warn" | "block" })}
              >
                <option value="warn">仅发送 Webhook 告警通知</option>
                <option value="block">立即熔断拦截所有代理请求 (429)</option>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                预警阈值比例 (%)
              </label>
              <Input
                type="number"
                min="10"
                max="100"
                value={budgetForm.alert_threshold_pct}
                onChange={(e) => setBudgetForm({ ...budgetForm, alert_threshold_pct: parseInt(e.target.value, 10) || 80 })}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button size="sm" type="submit" disabled={savingBudget}>
              {savingBudget ? "保存中…" : "保存预算配置"}
            </Button>
          </div>
        </form>
      </Card>

      {/* 7. Webhook Notifications */}
      <Card title="🔔 Webhook 告警与事件通知 (Webhook Alerts)">
        <form onSubmit={handleSaveWebhook} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Webhook URL (支持 飞书 / 钉钉 / 企业微信 / Slack / Discord)
            </label>
            <Input
              type="url"
              value={webhookForm.url}
              onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestWebhook}
              disabled={testingWebhook || !webhookForm.url}
            >
              {testingWebhook ? "测试中…" : "🧪 测试发送消息"}
            </Button>

            <Button size="sm" type="submit" disabled={savingWebhook}>
              {savingWebhook ? "保存中…" : "保存 Webhook 配置"}
            </Button>
          </div>
        </form>
      </Card>

      {/* 8. Cache Acceleration & Maintenance */}
      <Card title="⚡ 多级响应缓存优化 (Multi-Tier Caching)">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                L1 内存 LRU 缓存 + L2 Cloudflare KV 持久化
              </span>
              <Badge tone="green" dot>已启用</Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              高频重复请求优先命中内存（&lt;1ms 延迟），支持跨流式/非流式语义归一化复用。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePurgeCache}
            disabled={purging}
            className="text-rose-600 hover:text-rose-700 self-start sm:self-auto"
          >
            <IconTrash />
            <span>{purging ? "清理中…" : "一键清空网关缓存"}</span>
          </Button>
        </div>
      </Card>

      {/* 9. Integration Code Examples */}
      <Card title="💻 客户端接入指南 (SDK Code Snippets)">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 overflow-x-auto whitespace-nowrap">
            <button
              onClick={() => setActiveSnippetTab("openai")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeSnippetTab === "openai" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              OpenAI SDK (Python)
            </button>
            <button
              onClick={() => setActiveSnippetTab("anthropic")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeSnippetTab === "anthropic" ? "bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Anthropic SDK (TypeScript)
            </button>
            <button
              onClick={() => setActiveSnippetTab("gemini")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeSnippetTab === "gemini" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Gemini (via Gateway)
            </button>
            <button
              onClick={() => setActiveSnippetTab("curl")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shrink-0 ${
                activeSnippetTab === "curl" ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              cURL 请求
            </button>
          </div>

          <div className="rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-800 p-3.5 sm:p-4 text-xs font-mono text-slate-200">
            <div className="flex items-center justify-end mb-2">
              <CopyButton
                text={
                  activeSnippetTab === "openai"
                    ? openaiCode
                    : activeSnippetTab === "anthropic"
                    ? anthropicCode
                    : activeSnippetTab === "gemini"
                    ? geminiCode
                    : curlCode
                }
                label="复制代码"
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-xs"
              />
            </div>
            <pre className="whitespace-pre overflow-x-auto leading-relaxed">
              {activeSnippetTab === "openai"
                ? openaiCode
                : activeSnippetTab === "anthropic"
                ? anthropicCode
                : activeSnippetTab === "gemini"
                ? geminiCode
                : curlCode}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
