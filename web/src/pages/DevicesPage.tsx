import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, fmtTime } from "../api/client";
import type { DeviceItem } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Spinner, CopyButton } from "../components/ui";
import { IconPlus, IconDevices, IconShield, IconCopy } from "../components/icons";

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
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    const res = await api.get<{ items: DeviceItem[] }>("/api/devices");
    setItems(res.items);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post<CreateResponse>("/api/devices", { name });
      setName("");
      setShowCreate(false);
      setCreated(res);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
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
    if (!confirm(`确认永久撤销设备「${d.name}」？撤销后该 Token 将立即失效，无法恢复。`)) return;
    try {
      await api.post(`/api/devices/${d.id}/revoke`);
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  if (loading) return <Spinner text="正在加载设备 Token 列表…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">设备与客户端 Token</h2>
          <p className="text-xs text-slate-500 mt-1">
            为不同客户端（如 Cursor、VS Code 插件、本地脚本、手机）签发独立的鉴权 Token
          </p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setShowCreate(true);
          }}
          className="shadow-sm"
        >
          <IconPlus />
          <span>签发新设备 Token</span>
        </Button>
      </div>

      <Card className="overflow-x-auto">
        {items.length ? (
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-medium">
                <th className="pb-3 px-2">设备名称</th>
                <th className="pb-3 px-2">当前状态</th>
                <th className="pb-3 px-2">最近活跃时间</th>
                <th className="pb-3 px-2">创建时间</th>
                <th className="pb-3 px-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-2">
                    <div className="font-semibold text-slate-900">{d.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">ID: {d.id}</div>
                  </td>
                  <td className="py-3 px-2">
                    {d.revoked_at ? (
                      <Badge tone="red" dot>
                        已撤销
                      </Badge>
                    ) : d.enabled ? (
                      <Badge tone="green" dot>
                        正常
                      </Badge>
                    ) : (
                      <Badge tone="slate" dot>
                        已暂停
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-2 text-slate-600 text-xs">{fmtTime(d.last_used_at)}</td>
                  <td className="py-3 px-2 text-slate-400 text-xs">{fmtTime(d.created_at)}</td>
                  <td className="py-3 px-2 text-right">
                    {!d.revoked_at ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onToggle(d)}>
                          {d.enabled ? "暂停" : "恢复"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => onRevoke(d)}
                        >
                          撤销
                        </Button>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs italic">不可用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="尚未签发任何设备 Token" icon={<IconDevices className="w-8 h-8" />} />
        )}
      </Card>

      {/* Create Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="签发新设备 Token"
      >
        <form onSubmit={onCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">设备/应用名称</label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：MacBook Cursor / 本地工作站 / iOS 快捷指令"
              autoFocus
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              建议为每台设备分配专属名称，便于在用量记录中审计来源与精准撤销。
            </p>
          </div>

          {error ? <div className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "正在生成…" : "确认签发"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Token Created Modal */}
      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="设备 Token 签发成功">
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <IconShield className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <span className="font-semibold">请妥善保存此 Token！</span>
              <p className="mt-0.5 text-amber-800">
                该 Token 仅在此处展示一次，关闭窗口后将无法再次查看完整密钥。
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700">Bearer Token 密钥</div>
            <div className="rounded-xl bg-slate-900 p-3.5 font-mono text-xs break-all text-emerald-300 select-all border border-slate-800 flex items-center justify-between gap-2">
              <span>{created?.token}</span>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1 font-mono">
            <div className="text-slate-400 font-sans text-[11px] font-semibold">请求头使用示例：</div>
            <div>Authorization: Bearer {created?.token?.slice(0, 16)}...</div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              variant="secondary"
              onClick={() => {
                if (created) void navigator.clipboard?.writeText(created.token);
              }}
            >
              <IconCopy />
              <span>复制 Token</span>
            </Button>
            <Button onClick={() => setCreated(null)}>我已保存，完成</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
