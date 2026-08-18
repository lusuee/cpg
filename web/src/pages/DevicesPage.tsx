import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, fmtTime } from "../api/client";
import type { DeviceItem } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Spinner } from "../components/ui";

interface CreateResponse {
  item: DeviceItem;
  token: string;
}

export default function DevicesPage() {
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreateResponse | null>(null);

  const refresh = async () => setItems((await api.get<{ items: DeviceItem[] }>("/api/devices")).items);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post<CreateResponse>("/api/devices", { name });
      setName("");
      setShowCreate(false);
      setCreated(res);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    }
  }

  async function onToggle(d: DeviceItem) {
    try {
      await api.put(`/api/devices/${d.id}`, { enabled: !d.enabled });
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  async function onRevoke(d: DeviceItem) {
    if (!confirm(`确认撤销设备 ${d.name}？撤销后该 Token 将立即失效。`)) return;
    try {
      await api.post(`/api/devices/${d.id}/revoke`);
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">设备 Token</h1>
        <Button onClick={() => { setError(""); setShowCreate(true); }}>新增设备</Button>
      </div>

      <Card>
        {items.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th>名称</th>
                <th>状态</th>
                <th>最近使用</th>
                <th>创建时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{d.name}</td>
                  <td>
                    {d.revoked_at ? <Badge tone="red">已撤销</Badge> : d.enabled ? <Badge tone="green">启用</Badge> : <Badge tone="slate">禁用</Badge>}
                  </td>
                  <td className="text-slate-500">{fmtTime(d.last_used_at)}</td>
                  <td className="text-slate-500">{fmtTime(d.created_at)}</td>
                  <td className="text-right">
                    {!d.revoked_at ? (
                      <>
                        <Button variant="ghost" onClick={() => onToggle(d)}>{d.enabled ? "禁用" : "启用"}</Button>
                        <Button variant="danger" onClick={() => onRevoke(d)}>撤销</Button>
                      </>
                    ) : (
                      <span className="text-slate-400">已撤销</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="尚未创建设备" />}
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新增设备">
        <form onSubmit={onCreate} className="space-y-3">
          <label className="block text-sm">设备名称<Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的 MacBook" /></label>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>取消</Button>
            <Button type="submit">创建</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="设备已创建">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">请立即复制并保存 Token，它只会显示这一次：</p>
          <div className="rounded-lg bg-slate-900 p-3 font-mono text-sm break-all text-emerald-300">{created?.token}</div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { if (created) void navigator.clipboard?.writeText(created.token); }}>复制</Button>
            <Button onClick={() => setCreated(null)}>完成</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
