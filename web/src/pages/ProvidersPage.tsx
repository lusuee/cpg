import { useCallback, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";
import { IconPlus, IconEdit, IconTrash, IconProviders, IconModels, IconKey } from "../components/icons";
import { useQuery, invalidateCache } from "../hooks/useQuery";

interface FormState {
  id?: string;
  name: string;
  type: "anthropic" | "openai" | "gemini";
  endpoint: string;
  api_key: string;
  secret_name: string;
  enabled: boolean;
  config_json: string;
}

const emptyForm: FormState = {
  name: "",
  type: "openai",
  endpoint: "",
  api_key: "",
  secret_name: "",
  enabled: true,
  config_json: "",
};

export default function ProvidersPage() {
  const nav = useNavigate();
  const fetchProviders = useCallback(async () => {
    const res = await api.get<{ items: Provider[] }>("/api/providers");
    return res.items || [];
  }, []);

  const { data: items = [], loading, refresh } = useQuery("providers-list", fetchProviders);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [show, setShow] = useState(false);
  const [showKeyText, setShowKeyText] = useState(false);
  const [showAdvancedSecret, setShowAdvancedSecret] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openCreate() {
    setForm(emptyForm);
    setShowKeyText(false);
    setShowAdvancedSecret(false);
    setError("");
    setShow(true);
  }

  function openEdit(p: Provider) {
    setForm({
      id: p.id,
      name: p.name,
      type: p.type,
      endpoint: p.endpoint || "",
      api_key: "", // empty placeholder to avoid revealing or accidentally overwriting
      secret_name: p.secret_name || "",
      enabled: Boolean(p.enabled),
      config_json: p.config_json || "",
    });
    setShowKeyText(false);
    setShowAdvancedSecret(Boolean(p.secret_name));
    setError("");
    setShow(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (form.id) await api.put(`/api/providers/${form.id}`, serialize(form));
      else await api.post("/api/providers", serialize(form));
      setShow(false);
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(p: Provider) {
    if (!confirm(`确认删除 Provider「${p.name}」？关联的模型可能会受影响。`)) return;
    try {
      await api.del(`/api/providers/${p.id}`);
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  const currentEditingProvider = items.find((p) => p.id === form.id);

  if (loading && !items.length) return <Spinner text="正在加载 Provider 列表…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">上游 Provider 管理</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            配置上游 AI 服务商（OpenAI 兼容协议 / Anthropic / Google Gemini 协议）及其 API 密钥与地址（直接保存至数据库，即刻生效）
          </p>
        </div>
        <Button onClick={openCreate} className="shadow-sm">
          <IconPlus />
          <span>新增 Provider</span>
        </Button>
      </div>

      <Card className="overflow-x-auto">
        {items.length ? (
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                <th className="pb-3 px-2">名称</th>
                <th className="pb-3 px-2">协议类型</th>
                <th className="pb-3 px-2">自定义 Endpoint</th>
                <th className="pb-3 px-2">API 密钥 (Key)</th>
                <th className="pb-3 px-2">运行状态</th>
                <th className="pb-3 px-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="py-3 px-2 font-semibold text-slate-900 dark:text-slate-100">{p.name}</td>
                  <td className="py-3 px-2">
                    <Badge tone={p.type === "anthropic" ? "purple" : p.type === "gemini" ? "amber" : "blue"}>
                      {p.type === "anthropic" ? "Anthropic" : p.type === "gemini" ? "Gemini" : "OpenAI"}
                    </Badge>
                  </td>
                  <td className="py-3 px-2 font-mono text-slate-500 dark:text-slate-400 text-xs max-w-xs truncate">
                    {p.endpoint || <span className="text-slate-400 dark:text-slate-500 italic">官方默认</span>}
                  </td>
                  <td className="py-3 px-2">
                    {p.api_key_masked ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{p.api_key_masked}</span>
                        <Badge tone="green" dot>
                          数据库已存
                        </Badge>
                      </div>
                    ) : p.secret_name ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{p.secret_name}</span>
                        <Badge tone={p.secret_configured ? "green" : "red"} dot>
                          {p.secret_configured ? "CF Secret" : "未绑定"}
                        </Badge>
                      </div>
                    ) : (
                      <Badge tone="amber" dot>
                        未配置密钥
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <Badge tone={p.enabled ? "green" : "slate"} dot>
                      {p.enabled ? "启用" : "已停用"}
                    </Badge>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => nav("/models")}>
                        <IconModels />
                        <span>模型</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        <IconEdit />
                        <span>编辑</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        onClick={() => onDelete(p)}
                      >
                        <IconTrash />
                        <span>删除</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="尚未添加任何 Provider" icon={<IconProviders className="w-8 h-8" />} />
        )}
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={form.id ? "编辑 Provider" : "新增 Provider"}>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Provider 标识名称</label>
            <Input
              required
              placeholder="例如：OpenAI 官方 / Google Gemini / DeepSeek / 硅基流动"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">协议类型</label>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
              <option value="openai">OpenAI-compatible (包含 DeepSeek, Qwen, Moonshot 等)</option>
              <option value="anthropic">Anthropic (Claude 官方或兼容协议)</option>
              <option value="gemini">Google Gemini (Gemini 官方 API)</option>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                API 密钥 (API Key)
              </label>
              <button
                type="button"
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => setShowKeyText(!showKeyText)}
              >
                {showKeyText ? "隐藏明文" : "显示明文"}
              </button>
            </div>
            <Input
              type={showKeyText ? "text" : "password"}
              placeholder={
                form.id && currentEditingProvider?.api_key_configured
                  ? `留空表示保持当前密钥不变（已配置：${currentEditingProvider.api_key_masked || "已保存"}）`
                  : form.type === "gemini"
                  ? "例如 AIzaSy..."
                  : "例如 sk-..."
              }
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              💡 密钥将直接加密保存在数据库中，保存后立即生效，无需配置 Cloudflare 环境变量或重启 Worker。
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              API Base Endpoint <span className="text-slate-400 dark:text-slate-500 font-normal">（留空使用官方默认地址）</span>
            </label>
            <Input
              placeholder={
                form.type === "anthropic"
                  ? "https://api.anthropic.com/v1"
                  : form.type === "gemini"
                  ? "https://generativelanguage.googleapis.com/v1beta"
                  : "https://api.openai.com/v1"
              }
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            />
          </div>

          <div>
            <button
              type="button"
              className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1"
              onClick={() => setShowAdvancedSecret(!showAdvancedSecret)}
            >
              <span>{showAdvancedSecret ? "▼" : "▶"} 高级选项（Cloudflare Secret 变量名绑定）</span>
            </button>
            {showAdvancedSecret && (
              <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Cloudflare Secret 变量名 <span className="text-slate-400 font-normal">（可选，数据库 API Key 优先）</span>
                </label>
                <Input
                  placeholder="例如 OPENAI_API_KEY / GEMINI_API_KEY"
                  value={form.secret_name}
                  onChange={(e) => setForm({ ...form, secret_name: e.target.value })}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              高级 JSON 配置 <span className="text-slate-400 dark:text-slate-500 font-normal">（可选，JSON 格式）</span>
            </label>
            <Textarea
              rows={2}
              placeholder="{}"
              value={form.config_json}
              onChange={(e) => setForm({ ...form, config_json: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="provider-enabled"
              className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="provider-enabled" className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              立即启用此 Provider
            </label>
          </div>

          {error ? <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setShow(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "正在保存…" : "保存"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function serialize(f: FormState) {
  return {
    name: f.name.trim(),
    type: f.type,
    endpoint: f.endpoint?.trim() || null,
    api_key: f.api_key.trim() ? f.api_key.trim() : f.id ? undefined : null,
    secret_name: f.secret_name?.trim() || null,
    enabled: f.enabled,
    config_json: f.config_json?.trim() || null,
  };
}
