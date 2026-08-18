import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { ModelItem, Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";

interface FormState {
  id?: string;
  provider_id: string;
  model_name: string;
  display_name: string;
  alias: string;
  enabled: boolean;
  config_json: string;
}

export default function ModelsPage() {
  const [items, setItems] = useState<ModelItem[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>({ provider_id: "", model_name: "", display_name: "", alias: "", enabled: true, config_json: "" });

  const refresh = async () => {
    const [m, p] = await Promise.all([
      api.get<{ items: ModelItem[] }>("/api/models"),
      api.get<{ items: Provider[] }>("/api/providers"),
    ]);
    setItems(m.items);
    setProviders(p.items);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  function openCreate() { setForm({ provider_id: providers[0]?.id || "", model_name: "", display_name: "", alias: "", enabled: true, config_json: "" }); setShow(true); setError(""); }
  function openEdit(m: ModelItem) { setForm({ id: m.id, provider_id: m.provider_id, model_name: m.model_name, display_name: m.display_name || "", alias: m.alias || "", enabled: Boolean(m.enabled), config_json: m.config_json || "" }); setShow(true); setError(""); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (form.id) await api.put(`/api/models/${form.id}`, serialize(form));
      else await api.post("/api/models", serialize(form));
      setShow(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    }
  }

  async function onDelete(m: ModelItem) {
    if (!confirm(`确认删除 ${m.model_name}？`)) return;
    await api.del(`/api/models/${m.id}`);
    await refresh();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Model 管理</h1>
        <Button onClick={openCreate} disabled={!providers.length}>新增 Model</Button>
        {!providers.length ? <div className="text-sm text-amber-600">请先创建 Provider</div> : null}
      </div>
      <Card>
        {items.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th>模型名</th><th>显示名</th><th>别名</th><th>Provider</th><th>状态</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{m.model_name}</td>
                  <td>{m.display_name || "-"}</td>
                  <td className="text-slate-500">{m.alias || "-"}</td>
                  <td>{m.provider_name || m.provider_id}</td>
                  <td>{m.enabled ? <Badge tone="green">启用</Badge> : <Badge tone="red">禁用</Badge>}</td>
                  <td className="text-right">
                    <Button variant="ghost" onClick={() => openEdit(m)}>编辑</Button>
                    <Button variant="danger" onClick={() => onDelete(m)}>删除</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="尚未配置模型" />}
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={form.id ? "编辑 Model" : "新增 Model"}>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">Provider
            <Select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
            </Select>
          </label>
          <label className="block text-sm">上游模型名<Input required value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="claude-3-5-sonnet-20241022" /></label>
          <label className="block text-sm">显示名<Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
          <label className="block text-sm">别名（可选）<Input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="claude" /></label>
          <label className="block text-sm">config_json<Textarea rows={3} value={form.config_json} onChange={(e) => setForm({ ...form, config_json: e.target.value })} /></label>
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
    provider_id: f.provider_id,
    model_name: f.model_name,
    display_name: f.display_name || undefined,
    alias: f.alias || undefined,
    enabled: f.enabled,
    config_json: f.config_json || undefined,
  };
}
