import { useCallback, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";
import { IconPlus, IconEdit, IconTrash, IconProviders, IconModels } from "../components/icons";
import { useQuery, invalidateCache } from "../hooks/useQuery";

interface FormState {
  id?: string;
  name: string;
  type: "anthropic" | "openai";
  endpoint: string;
  secret_name: string;
  enabled: boolean;
  config_json: string;
}

const emptyForm: FormState = {
  name: "",
  type: "openai",
  endpoint: "",
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
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openCreate() {
    setForm(emptyForm);
    setError("");
    setShow(true);
  }

  function openEdit(p: Provider) {
    setForm({
      id: p.id,
      name: p.name,
      type: p.type,
      endpoint: p.endpoint || "",
      secret_name: p.secret_name || "",
      enabled: Boolean(p.enabled),
      config_json: p.config_json || "",
    });
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

  if (loading && !items.length) return <Spinner text="正在加载 Provider 列表…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">上游 Provider 管理</h2>
          <p className="text-xs text-slate-500 mt-1">配置上游 AI 服务商（OpenAI 兼容协议 / Anthropic 协议）及其 API 密钥与地址</p>
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
              <tr className="border-b border-slate-100 text-slate-400 font-medium">
                <th className="pb-3 px-2">名称</th>
                <th className="pb-3 px-2">协议类型</th>
                <th className="pb-3 px-2">自定义 Endpoint</th>
                <th className="pb-3 px-2">Secret 密钥</th>
                <th className="pb-3 px-2">运行状态</th>
                <th className="pb-3 px-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-2 font-semibold text-slate-900">{p.name}</td>
                  <td className="py-3 px-2">
                    <Badge tone={p.type === "anthropic" ? "purple" : "blue"}>
                      {p.type === "anthropic" ? "Anthropic" : "OpenAI"}
                    </Badge>
                  </td>
                  <td className="py-3 px-2 font-mono text-slate-500 text-xs max-w-xs truncate">
                    {p.endpoint || <span className="text-slate-400 italic">官方默认</span>}
                  </td>
                  <td className="py-3 px-2">
                    {p.secret_name ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-700">{p.secret_name}</span>
                        <Badge tone={p.secret_configured ? "green" : "red"} dot>
                          {p.secret_configured ? "有效" : "未绑定"}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs">无 Secret</span>
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
                      <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => onDelete(p)}>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Provider 标识名称</label>
            <Input
              required
              placeholder="例如：OpenAI 官方 / DeepSeek / 阶跃星辰"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">协议类型</label>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Secret 变量名</label>
              <Input
                placeholder="例如 OPENAI_API_KEY"
                value={form.secret_name}
                onChange={(e) => setForm({ ...form, secret_name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              API Base Endpoint <span className="text-slate-400 font-normal">（留空使用官方默认地址）</span>
            </label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              高级 JSON 配置 <span className="text-slate-400 font-normal">（可选，JSON 格式）</span>
            </label>
            <Textarea
              rows={3}
              placeholder="{}"
              value={form.config_json}
              onChange={(e) => setForm({ ...form, config_json: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="provider-enabled"
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="provider-enabled" className="text-xs font-medium text-slate-700 cursor-pointer select-none">
              立即启用此 Provider
            </label>
          </div>

          {error ? <div className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
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
    name: f.name,
    type: f.type,
    endpoint: f.endpoint || undefined,
    secret_name: f.secret_name || undefined,
    enabled: f.enabled,
    config_json: f.config_json || undefined,
  };
}
