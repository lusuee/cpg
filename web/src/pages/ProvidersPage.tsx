import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";

interface FormState {
  id?: string;
  name: string;
  type: "anthropic" | "openai";
  endpoint: string;
  secret_name: string;
  enabled: boolean;
  config_json: string;
}

const emptyForm: FormState = { name: "", type: "openai", endpoint: "", secret_name: "", enabled: true, config_json: "" };

export default function ProvidersPage() {
  const [items, setItems] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => setItems((await api.get<{ items: Provider[] }>("/api/providers")).items);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  function openCreate() { setForm(emptyForm); setError(""); setShow(true); }
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
    try {
      if (form.id) await api.put(`/api/providers/${form.id}`, serialize(form));
      else await api.post("/api/providers", serialize(form));
      setShow(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    }
  }

  async function onDelete(p: Provider) {
    if (!confirm(`确认删除 ${p.name}？`)) return;
    try {
      await api.del(`/api/providers/${p.id}`);
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Provider 管理</h1>
        <Button onClick={openCreate}>新增 Provider</Button>
      </div>
      <Card>
        {items.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th>名称</th><th>类型</th><th>Endpoint</th><th>Secret</th><th>状态</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td>{p.type}</td>
                  <td className="max-w-56 truncate text-slate-500">{p.endpoint || "默认"}</td>
                  <td>
                    {p.secret_name ? (
                      <Badge tone={p.secret_configured ? "green" : "red"}>{p.secret_configured ? "已配置" : "未配置"}</Badge>
                    ) : <Badge>无</Badge>}
                  </td>
                  <td>{p.enabled ? <Badge tone="green">启用</Badge> : <Badge tone="red">禁用</Badge>}</td>
                  <td className="text-right">
                    <Button variant="ghost" onClick={() => openEdit(p)}>编辑</Button>
                    <Button variant="danger" onClick={() => onDelete(p)}>删除</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty />}
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={form.id ? "编辑 Provider" : "新增 Provider"}>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">名称<Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block text-sm">类型
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </Select>
          </label>
          <label className="block text-sm">Endpoint（留空使用默认）<Input placeholder="https://api.openai.com/v1" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} /></label>
          <label className="block text-sm">Secret 名称<Input placeholder="OPENAI_API_KEY" value={form.secret_name} onChange={(e) => setForm({ ...form, secret_name: e.target.value })} /></label>
          <label className="block text-sm">config_json <Textarea rows={3} value={form.config_json} onChange={(e) => setForm({ ...form, config_json: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用</label>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setShow(false)}>取消</Button><Button type="submit">保存</Button></div>
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
