import { useCallback, useState, type FormEvent } from "react";
import { api, ApiError, fmtTime } from "../api/client";
import type { DeviceItem } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Spinner } from "../components/ui";
import { IconPlus, IconEdit, IconDevices, IconShield, IconCopy } from "../components/icons";
import { useToast } from "../components/Toast";
import { useQuery } from "../hooks/useQuery";

interface CreateResponse {
  item: DeviceItem;
  token: string;
}

export default function DevicesPage() {
  const toast = useToast();
  const fetchDevices = useCallback(async () => {
    const res = await api.get<{ items: DeviceItem[] }>("/api/devices");
    return res.items || [];
  }, []);

  const { data: items = [], loading, refresh } = useQuery("devices-list", fetchDevices);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState<string>("0");
  const [costLimitMonthly, setCostLimitMonthly] = useState<string>("0");
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingDevice, setEditingDevice] = useState<DeviceItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editRpm, setEditRpm] = useState("0");
  const [editCostLimit, setEditCostLimit] = useState("0");

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await api.post<CreateResponse>("/api/devices", {
        name: name.trim(),
        rate_limit_rpm: parseInt(rateLimitRpm, 10) || 0,
        cost_limit_monthly: parseFloat(costLimitMonthly) || 0,
      });
      setCreated(res);
      setName("");
      setRateLimitRpm("0");
      setCostLimitMonthly("0");
      setShowCreate(false);
      await refresh();
      toast.success(`已成功创建设备「${res.item.name}」`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(d: DeviceItem) {
    setEditingDevice(d);
    setEditName(d.name);
    setEditRpm(String(d.rate_limit_rpm || 0));
    setEditCostLimit(String(d.cost_limit_monthly || 0));
    setError("");
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;
    setSubmitting(true);
    try {
      await api.put(`/api/devices/${editingDevice.id}`, {
        name: editName.trim(),
        rate_limit_rpm: parseInt(editRpm, 10) || 0,
        cost_limit_monthly: parseFloat(editCostLimit) || 0,
      });
      setEditingDevice(null);
      await refresh();
      toast.success(`设备「${editName}」已更新`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggle(d: DeviceItem) {
    try {
      await api.put(`/api/devices/${d.id}`, { enabled: !d.enabled });
      await refresh();
      toast.success(`设备「${d.name}」已${d.enabled ? "禁用" : "启用"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  async function onRevoke(d: DeviceItem) {
    if (!confirm(`确认永久撤销设备「${d.name}」？撤销后该 Token 将立即失效，无法恢复。`)) return;
    try {
      await api.post(`/api/devices/${d.id}/revoke`);
      await refresh();
      toast.success(`设备「${d.name}」Token 已成功撤销`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  if (loading && !items.length) return <Spinner text="正在加载设备 Token 列表…" />;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">设备与客户端 Token</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            为不同客户端（如 Cursor、VS Code 插件、本地脚本、手机）签发独立的鉴权 Token 与速率限制
          </p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setName("");
            setRateLimitRpm("0");
            setShowCreate(true);
          }}
          className="shadow-sm w-full sm:w-auto"
        >
          <IconPlus />
          <span>签发新设备 Token</span>
        </Button>
      </div>

      <Card>
        {items.length ? (
          <div className="overflow-x-auto -mx-4 -my-4 sm:mx-0 sm:my-0">
            <table className="w-full text-left text-xs sm:text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                  <th className="pb-3 px-3 whitespace-nowrap">设备名称</th>
                  <th className="pb-3 px-2 whitespace-nowrap">当前状态</th>
                  <th className="pb-3 px-2 whitespace-nowrap">每分钟限流 (RPM)</th>
                  <th className="pb-3 px-2 whitespace-nowrap">本月消费 / 限额</th>
                  <th className="pb-3 px-2 whitespace-nowrap">最近活跃时间</th>
                  <th className="pb-3 px-2 whitespace-nowrap">创建时间</th>
                  <th className="pb-3 px-3 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((d) => {
                  const spend = d.current_month_cost || 0;
                  const limit = d.cost_limit_monthly || 0;
                  const isBlocked = limit > 0 && spend >= limit;
                  const pct = limit > 0 ? Math.min(100, Math.round((spend / limit) * 100)) : 0;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{d.name}</div>
                        <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500">ID: {d.id}</div>
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        {d.revoked_at ? (
                          <Badge tone="red" dot>
                            已撤销
                          </Badge>
                        ) : isBlocked ? (
                          <Badge tone="red" dot>
                            已超额熔断
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
                      <td className="py-3 px-2 font-mono text-xs whitespace-nowrap">
                        {d.rate_limit_rpm ? (
                          <Badge tone="blue">{d.rate_limit_rpm} 次/分</Badge>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">无限制</span>
                        )}
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        {limit > 0 ? (
                          <div className="space-y-1 min-w-[130px]">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <span className={isBlocked ? "text-rose-600 font-bold" : "text-slate-700 dark:text-slate-300"}>
                                ${spend.toFixed(2)}
                              </span>
                              <span className="text-slate-400">/ ${limit.toFixed(2)}</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  pct >= 100
                                    ? "bg-rose-500"
                                    : pct >= 80
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                            ${spend.toFixed(2)} <span className="text-slate-400 font-sans text-[11px]">(不设限)</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">{fmtTime(d.last_used_at)}</td>
                      <td className="py-3 px-2 text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">{fmtTime(d.created_at)}</td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {!d.revoked_at ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                              <IconEdit />
                              <span>编辑</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => onToggle(d)}>
                              {d.enabled ? "暂停" : "恢复"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              onClick={() => onRevoke(d)}
                            >
                              撤销
                            </Button>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-xs italic">不可用</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">设备/应用名称</label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：MacBook Cursor / 本地工作站 / iOS 快捷指令"
              autoFocus
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
              建议为每台设备分配专属名称，便于在用量记录中审计来源与精准撤销。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                每分钟限流 (RPM) <span className="text-slate-400 dark:text-slate-500 font-normal">（0为不限）</span>
              </label>
              <Input
                type="number"
                min="0"
                value={rateLimitRpm}
                onChange={(e) => setRateLimitRpm(e.target.value)}
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                月度费用限额 ($) <span className="text-slate-400 dark:text-slate-500 font-normal">（0为不限）</span>
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={costLimitMonthly}
                onChange={(e) => setCostLimitMonthly(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {error ? <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "正在生成…" : "确认签发"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={Boolean(editingDevice)}
        onClose={() => setEditingDevice(null)}
        title="编辑设备配置"
      >
        <form onSubmit={onSaveEdit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">设备/应用名称</label>
            <Input
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="设备名称"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                每分钟限流 (RPM) <span className="text-slate-400 dark:text-slate-500 font-normal">（0为不限）</span>
              </label>
              <Input
                type="number"
                min="0"
                value={editRpm}
                onChange={(e) => setEditRpm(e.target.value)}
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                月度费用限额 ($) <span className="text-slate-400 dark:text-slate-500 font-normal">（0为不限）</span>
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={editCostLimit}
                onChange={(e) => setEditCostLimit(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {error ? <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setEditingDevice(null)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "正在保存…" : "保存修改"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Token Created Modal */}
      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="设备 Token 签发成功">
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-xs">
            <IconShield className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <span className="font-semibold">请妥善保存此 Token！</span>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                该 Token 仅在此处展示一次，关闭窗口后将无法再次查看完整密钥。
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Bearer Token 密钥</div>
            <div className="rounded-xl bg-slate-900 dark:bg-slate-950 p-3.5 font-mono text-xs break-all text-emerald-300 select-all border border-slate-800 flex items-center justify-between gap-2">
              <span>{created?.token}</span>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1 font-mono">
            <div className="text-slate-400 dark:text-slate-500 font-sans text-[11px] font-semibold">请求头使用示例：</div>
            <div>Authorization: Bearer {created?.token?.slice(0, 16)}...</div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
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

