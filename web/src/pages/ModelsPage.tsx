import { useCallback, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { ModelItem, Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";
import { IconPlus, IconEdit, IconTrash, IconModels, IconSearch, IconRefresh } from "../components/icons";
import { useQuery, invalidateCache } from "../hooks/useQuery";

interface FormState {
  id?: string;
  provider_id: string;
  model_name: string;
  display_name: string;
  alias: string;
  enabled: boolean;
  config_json: string;
}

interface ModelsPageData {
  items: ModelItem[];
  providers: Provider[];
}

export default function ModelsPage() {
  const fetchModelsData = useCallback(async (): Promise<ModelsPageData> => {
    const [m, p] = await Promise.all([
      api.get<{ items: ModelItem[] }>("/api/models"),
      api.get<{ items: Provider[] }>("/api/providers"),
    ]);
    return {
      items: m.items || [],
      providers: p.items || [],
    };
  }, []);

  const { data, loading, refresh } = useQuery("models-page-data", fetchModelsData);
  const items = data?.items || [];
  const providers = data?.providers || [];

  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>({
    provider_id: "",
    model_name: "",
    display_name: "",
    alias: "",
    enabled: true,
    config_json: "",
  });

  // Sync / Auto-fetch modal state
  const [showSync, setShowSync] = useState(false);
  const [syncProviderId, setSyncProviderId] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [syncFilter, setSyncFilter] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncSubmitting, setSyncSubmitting] = useState(false);

  function openCreate() {
    setForm({
      provider_id: providers[0]?.id || "",
      model_name: "",
      display_name: "",
      alias: "",
      enabled: true,
      config_json: "",
    });
    setShow(true);
    setError("");
  }

  function openEdit(m: ModelItem) {
    setForm({
      id: m.id,
      provider_id: m.provider_id,
      model_name: m.model_name,
      display_name: m.display_name || "",
      alias: m.alias || "",
      enabled: Boolean(m.enabled),
      config_json: m.config_json || "",
    });
    setShow(true);
    setError("");
  }

  function openSync() {
    setSyncProviderId(providers[0]?.id || "");
    setFetchedModels([]);
    setSelectedModels(new Set());
    setSyncFilter("");
    setSyncError("");
    setShowSync(true);
  }

  async function handleFetchFromUpstream(provId: string) {
    if (!provId) return;
    setSyncLoading(true);
    setSyncError("");
    try {
      const res = await api.post<{ models: string[] }>(`/api/providers/${provId}/fetch-models`);
      setFetchedModels(res.models || []);
      // Pre-select models not already in items
      const existingNames = new Set(items.filter((m) => m.provider_id === provId).map((m) => m.model_name));
      const nextSelected = new Set<string>();
      for (const m of res.models || []) {
        if (!existingNames.has(m)) nextSelected.add(m);
      }
      setSelectedModels(nextSelected);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : "获取模型失败");
      setFetchedModels([]);
    } finally {
      setSyncLoading(false);
    }
  }

  async function onBatchImport() {
    if (!syncProviderId || !selectedModels.size) return;
    setSyncSubmitting(true);
    setSyncError("");
    try {
      const modelsToImport = Array.from(selectedModels).map((name) => ({ model_name: name }));
      await api.post("/api/models/batch", {
        provider_id: syncProviderId,
        models: modelsToImport,
      });
      setShowSync(false);
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : "批量导入失败");
    } finally {
      setSyncSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (form.id) await api.put(`/api/models/${form.id}`, serialize(form));
      else await api.post("/api/models", serialize(form));
      setShow(false);
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(m: ModelItem) {
    if (!confirm(`确认删除模型「${m.model_name}」？`)) return;
    try {
      await api.del(`/api/models/${m.id}`);
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  if (loading && !items.length) return <Spinner text="正在加载模型列表…" />;

  const filteredItems = items.filter(
    (m) =>
      m.model_name.toLowerCase().includes(search.toLowerCase()) ||
      (m.display_name && m.display_name.toLowerCase().includes(search.toLowerCase())) ||
      (m.alias && m.alias.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredSyncModels = fetchedModels.filter((m) =>
    m.toLowerCase().includes(syncFilter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">模型路由映射</h2>
          <p className="text-xs text-slate-500 mt-1">
            配置允许客户端调用的模型、上游 Provider 绑定以及自定义别名（Alias）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openSync} disabled={!providers.length} className="shadow-sm">
            <IconRefresh />
            <span>从上游拉取并导入</span>
          </Button>
          <Button onClick={openCreate} disabled={!providers.length} className="shadow-sm">
            <IconPlus />
            <span>新增 Model</span>
          </Button>
        </div>
      </div>

      {!providers.length ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
          <span>⚠️ 尚未创建任何 Provider，请先前往「Providers」页面创建上游服务商。</span>
        </div>
      ) : null}

      <div className="flex items-center gap-3 max-w-sm">
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <IconSearch />
          </div>
          <Input
            className="pl-9"
            placeholder="搜索模型名 / 显示名 / 别名…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="overflow-x-auto">
        {filteredItems.length ? (
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-medium">
                <th className="pb-3 px-2">上游模型名</th>
                <th className="pb-3 px-2">显示名称</th>
                <th className="pb-3 px-2">客户端别名</th>
                <th className="pb-3 px-2">绑定 Provider</th>
                <th className="pb-3 px-2">状态</th>
                <th className="pb-3 px-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-2 font-mono font-medium text-slate-900">{m.model_name}</td>
                  <td className="py-3 px-2 text-slate-700">{m.display_name || "-"}</td>
                  <td className="py-3 px-2">
                    {m.alias ? <Badge tone="blue">{m.alias}</Badge> : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="py-3 px-2 text-slate-600 font-medium">
                    {m.provider_name || <span className="font-mono text-xs text-slate-400">{m.provider_id}</span>}
                  </td>
                  <td className="py-3 px-2">
                    <Badge tone={m.enabled ? "green" : "slate"} dot>
                      {m.enabled ? "启用" : "已停用"}
                    </Badge>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                        <IconEdit />
                        <span>编辑</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => onDelete(m)}
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
          <Empty text="未找到匹配的模型" icon={<IconModels className="w-8 h-8" />} />
        )}
      </Card>

      {/* Sync from Upstream Modal */}
      <Modal
        open={showSync}
        onClose={() => setShowSync(false)}
        title="从上游 Provider 自动拉取模型列表"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">选择上游 Provider</label>
            <div className="flex gap-2">
              <Select
                value={syncProviderId}
                onChange={(e) => {
                  setSyncProviderId(e.target.value);
                  setFetchedModels([]);
                  setSelectedModels(new Set());
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                onClick={() => handleFetchFromUpstream(syncProviderId)}
                disabled={syncLoading || !syncProviderId}
              >
                {syncLoading ? "正在拉取…" : "获取可用模型"}
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              网关将使用该 Provider 配置的 Secret Key 请求上游 <code>GET /models</code> 接口。
            </p>
          </div>

          {syncError ? <div className="text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg">{syncError}</div> : null}

          {fetchedModels.length ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-700">
                  上游返回 {fetchedModels.length} 个模型 (已选 {selectedModels.size} 个)
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (selectedModels.size === filteredSyncModels.length) {
                        setSelectedModels(new Set());
                      } else {
                        setSelectedModels(new Set(filteredSyncModels));
                      }
                    }}
                  >
                    {selectedModels.size === filteredSyncModels.length ? "全不选" : "全选当前"}
                  </Button>
                </div>
              </div>

              <Input
                placeholder="快速筛选上游模型名…"
                value={syncFilter}
                onChange={(e) => setSyncFilter(e.target.value)}
              />

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-2 divide-y divide-slate-100 bg-slate-50/50">
                {filteredSyncModels.map((name) => {
                  const isChecked = selectedModels.has(name);
                  const isExisting = items.some(
                    (m) => m.provider_id === syncProviderId && m.model_name === name
                  );
                  return (
                    <label
                      key={name}
                      className="flex items-center justify-between py-1.5 px-2 hover:bg-white rounded-lg cursor-pointer text-xs transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedModels);
                            if (e.target.checked) next.add(name);
                            else next.delete(name);
                            setSelectedModels(next);
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                        />
                        <span className="font-mono font-medium text-slate-800">{name}</span>
                      </div>
                      {isExisting ? <Badge tone="slate">已在列表中</Badge> : <Badge tone="green">新模型</Badge>}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setShowSync(false)}>
              关闭
            </Button>
            {fetchedModels.length ? (
              <Button
                variant="primary"
                onClick={onBatchImport}
                disabled={syncSubmitting || !selectedModels.size}
              >
                {syncSubmitting ? "正在导入…" : `一键导入选中的 ${selectedModels.size} 个模型`}
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Create / Edit Single Model Modal */}
      <Modal open={show} onClose={() => setShow(false)} title={form.id ? "编辑 Model" : "新增 Model"}>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">上游 Provider</label>
            <Select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">上游模型标识 (Model ID)</label>
            <Input
              required
              placeholder="例如 gpt-4o / claude-3-5-sonnet-20241022 / deepseek-chat"
              value={form.model_name}
              onChange={(e) => setForm({ ...form, model_name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">显示名称（可选）</label>
              <Input
                placeholder="例如 Claude 3.5 Sonnet"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">快捷别名（可选）</label>
              <Input
                placeholder="例如 claude / gpt4"
                value={form.alias}
                onChange={(e) => setForm({ ...form, alias: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              高级 JSON 覆盖配置 <span className="text-slate-400 font-normal">（可选）</span>
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
              id="model-enabled"
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <label htmlFor="model-enabled" className="text-xs font-medium text-slate-700 cursor-pointer select-none">
              立即启用此模型
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
    provider_id: f.provider_id,
    model_name: f.model_name,
    display_name: f.display_name || undefined,
    alias: f.alias || undefined,
    enabled: f.enabled,
    config_json: f.config_json || undefined,
  };
}
