import { useCallback, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner, Textarea } from "../components/ui";
import { IconPlus, IconEdit, IconTrash, IconProviders, IconCheck, IconSearch, IconUpload } from "../components/icons";
import { useToast } from "../components/Toast";
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

interface ParsedImportModel {
  model_name: string;
  display_name?: string;
  alias?: string;
  input_price_per_m?: number;
  output_price_per_m?: number;
}

interface ParsedImportProvider {
  name: string;
  type: "anthropic" | "openai" | "gemini";
  endpoint: string | null;
  api_key: string | null;
  api_key_masked?: string | null;
  enabled: boolean;
  models: ParsedImportModel[];
  config_json?: string;
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
  const toast = useToast();
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

  // Search and filter state
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");

  // Table batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);

  // CC-Switch Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRaw, setImportRaw] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedImportProvider[] | null>(null);
  const [importSelectedIndices, setImportSelectedIndices] = useState<Set<number>>(new Set());
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importModels, setImportModels] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  function openImport() {
    setImportRaw("");
    setImportPreview(null);
    setImportSelectedIndices(new Set());
    setImportOverwrite(false);
    setImportModels(true);
    setImportError("");
    setImportSuccess(null);
    setShowImportModal(true);
  }

  function openCreate() {
    setForm(emptyForm);
    setShowKeyText(false);
    setShowAdvancedSecret(false);
    setError("");
    setShow(true);
  }

  async function handleParsePreview() {
    if (!importRaw.trim()) return;
    setParsing(true);
    setImportError("");
    try {
      const res = await api.post<{ items: ParsedImportProvider[]; count: number }>("/api/providers/ccswitch/preview", {
        raw: importRaw.trim(),
      });
      if (!res.items || !res.items.length) {
        setImportError("未能解析到有效的 CC-Switch 配置，请确认内容包含 SQL 语句、JSON 配置或 ccswitch:// 链接");
        return;
      }
      setImportPreview(res.items);
      setImportSelectedIndices(new Set(res.items.map((_, i) => i)));
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "解析配置失败");
    } finally {
      setParsing(false);
    }
  }

  const toggleSelectAllImport = () => {
    if (!importPreview) return;
    if (importSelectedIndices.size === importPreview.length) {
      setImportSelectedIndices(new Set());
    } else {
      setImportSelectedIndices(new Set(importPreview.map((_, i) => i)));
    }
  };

  const toggleSelectImportIndex = (idx: number) => {
    setImportSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  async function handleExecuteImport() {
    if (!importPreview || !importSelectedIndices.size) return;
    setImporting(true);
    setImportError("");
    setImportSuccess(null);

    const selectedItems = Array.from(importSelectedIndices)
      .sort((a, b) => a - b)
      .map((i) => importPreview[i]);

    try {
      const res = await api.post<{
        success: boolean;
        imported_providers: number;
        updated_providers: number;
        imported_models: number;
      }>("/api/providers/ccswitch/import", {
        items: selectedItems,
        overwrite: importOverwrite,
        import_models: importModels,
      });

      const provCount = (res.imported_providers || 0) + (res.updated_providers || 0);
      setImportSuccess(
        `🎉 成功导入 ${provCount} 个 Provider（新增 ${res.imported_providers} 个，更新 ${res.updated_providers} 个），自动创建 ${res.imported_models} 个关联模型！`
      );

      invalidateCache("providers-list");
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "导入配置失败");
    } finally {
      setImporting(false);
    }
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

    if (form.config_json && form.config_json.trim()) {
      try {
        JSON.parse(form.config_json);
      } catch (err: any) {
        setError(`高级配置不是合法的 JSON 格式: ${err.message}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (form.id) {
        await api.put(`/api/providers/${form.id}`, serialize(form));
        toast.success(`Provider「${form.name}」已更新`);
      } else {
        await api.post("/api/providers", serialize(form));
        toast.success(`Provider「${form.name}」已创建`);
      }
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
      toast.success(`Provider「${p.name}」已删除`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  async function onToggleSingle(p: Provider) {
    try {
      await api.put(`/api/providers/${p.id}`, { enabled: !p.enabled });
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
      toast.success(`Provider「${p.name}」已${p.enabled ? "禁用" : "启用"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    }
  }

  // Batch actions
  async function handleBatchEnable(enabled: boolean) {
    if (!selectedIds.size) return;
    setBatchOperating(true);
    try {
      await api.post("/api/providers/batch-update", {
        ids: Array.from(selectedIds),
        enabled,
      });
      const count = selectedIds.size;
      setSelectedIds(new Set());
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
      toast.success(`已批量${enabled ? "启用" : "禁用"} ${count} 个 Provider`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "批量更新失败");
    } finally {
      setBatchOperating(false);
    }
  }

  async function handleBatchDelete() {
    if (!selectedIds.size) return;
    if (!confirm(`确定要永久删除选中的 ${selectedIds.size} 个 Provider 吗？关联的模型可能无法正常调用。`)) return;
    setBatchOperating(true);
    try {
      const res = await api.post<{ deleted: number; skipped: number }>("/api/providers/batch-delete", {
        ids: Array.from(selectedIds),
      });
      setSelectedIds(new Set());
      invalidateCache("models-");
      invalidateCache("dashboard-");
      await refresh();
      if (res.skipped > 0) {
        toast.info(`已删除 ${res.deleted} 个 Provider。有 ${res.skipped} 个因名下仍有关联模型被跳过，请先删除关联模型。`);
      } else {
        toast.success(`已成功删除 ${res.deleted} 个 Provider`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "批量删除失败");
    } finally {
      setBatchOperating(false);
    }
  }

  const filteredItems = items.filter((p) => {
    if (filterType && p.type !== filterType) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.endpoint && p.endpoint.toLowerCase().includes(q)) ||
      (p.secret_name && p.secret_name.toLowerCase().includes(q)) ||
      p.type.toLowerCase().includes(q)
    );
  });

  const isAllSelected = filteredItems.length > 0 && filteredItems.every((p) => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((p) => p.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentEditingProvider = items.find((p) => p.id === form.id);

  if (loading && !items.length) return <Spinner text="正在加载 Provider 列表…" />;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">上游 Provider 管理</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            配置上游 AI 服务商（OpenAI 兼容协议 / Anthropic / Google Gemini 协议）及其 API 密钥与地址
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button variant="secondary" onClick={openImport} className="shadow-sm w-full sm:w-auto">
            <IconUpload />
            <span>导入 CC Switch 配置</span>
          </Button>
          <Button onClick={openCreate} className="shadow-sm w-full sm:w-auto">
            <IconPlus />
            <span>新增 Provider</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch />
            </div>
            <Input
              className="pl-9"
              placeholder="搜索 Provider / Endpoint…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-44">
            <Select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">全部协议 ({items.length})</option>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </Select>
          </div>
        </div>

        {/* Floating / Inline Batch Operations Toolbar */}
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-3 py-1.5 rounded-xl text-xs animate-in fade-in slide-in-from-top-1 duration-200 w-full sm:w-auto">
            <span className="font-semibold text-blue-900 dark:text-blue-300">已选 {selectedIds.size} 项</span>
            <div className="h-4 w-px bg-blue-200 dark:bg-blue-800 mx-1 hidden sm:block" />
            <Button
              size="sm"
              variant="outline"
              disabled={batchOperating}
              onClick={() => handleBatchEnable(true)}
              className="bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-none"
            >
              <IconCheck />
              <span>启用</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={batchOperating}
              onClick={() => handleBatchEnable(false)}
              className="bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-none"
            >
              <span>停用</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={batchOperating}
              onClick={handleBatchDelete}
              className="bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 border-rose-200 dark:border-rose-800 shadow-none"
            >
              <IconTrash />
              <span>删除</span>
            </Button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto sm:ml-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-medium cursor-pointer"
            >
              取消
            </button>
          </div>
        ) : null}
      </div>

      <Card>
        {filteredItems.length ? (
          <div className="overflow-x-auto -mx-4 -my-4 sm:mx-0 sm:my-0">
            <table className="w-full text-left text-xs sm:text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                  <th className="pb-3 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer align-middle"
                    />
                  </th>
                  <th className="pb-3 px-2 whitespace-nowrap">名称</th>
                  <th className="pb-3 px-2 whitespace-nowrap">协议类型</th>
                  <th className="pb-3 px-2 whitespace-nowrap">自定义 Endpoint</th>
                  <th className="pb-3 px-2 whitespace-nowrap">API 密钥 (Key)</th>
                  <th className="pb-3 px-2 whitespace-nowrap">运行状态</th>
                  <th className="pb-3 px-3 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((p) => {
                  const isSelected = selectedIds.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={`transition-colors ${isSelected ? "bg-blue-50/50 dark:bg-blue-950/40" : "hover:bg-slate-50/60 dark:hover:bg-slate-800/50"}`}
                    >
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(p.id)}
                          className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer align-middle"
                        />
                      </td>
                      <td className="py-3 px-2 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{p.name}</td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        <Badge tone={p.type === "anthropic" ? "purple" : p.type === "gemini" ? "amber" : "blue"}>
                          {p.type === "anthropic" ? "Anthropic" : p.type === "gemini" ? "Gemini" : "OpenAI"}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 font-mono text-slate-500 dark:text-slate-400 text-xs max-w-[180px] truncate">
                        {p.endpoint || <span className="text-slate-400 dark:text-slate-500 italic">官方默认</span>}
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        {p.api_key_masked ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{p.api_key_masked}</span>
                            <Badge tone="green" dot>
                              已存
                            </Badge>
                          </div>
                        ) : p.secret_name ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{p.secret_name}</span>
                            <Badge tone={p.secret_configured ? "green" : "red"} dot>
                              {p.secret_configured ? "Secret" : "未绑"}
                            </Badge>
                          </div>
                        ) : (
                          <Badge tone="amber" dot>
                            未配置
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onToggleSingle(p)}
                          title="点击快速切换启用/停用状态"
                          className="cursor-pointer group"
                        >
                          <Badge tone={p.enabled ? "green" : "slate"} dot className="group-hover:opacity-80 transition-opacity">
                            {p.enabled ? "启用" : "已停用"}
                          </Badge>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text={items.length ? "未找到匹配的 Provider" : "尚未添加任何 Provider"} icon={<IconProviders className="w-8 h-8" />} />
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

      {/* CC-Switch Import Modal */}
      <Modal
        open={showImportModal}
        onClose={() => {
          if (!importing) setShowImportModal(false);
        }}
        title="导入 CC Switch 配置"
      >
        <div className="space-y-4">
          {!importPreview ? (
            <>
              <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <span>💡 支持的 CC Switch 配置格式：</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <li>CC-Switch 导出的 SQL 备份文件（如 <code className="text-blue-600 dark:text-blue-400">cc-switch-export-*.sql</code>）</li>
                  <li>CC-Switch JSON 配置数组或快照（<code className="text-blue-600 dark:text-blue-400">[&#123; name, settings_config, ... &#125;]</code>）</li>
                  <li>CC-Switch 快捷导入链接（<code className="text-blue-600 dark:text-blue-400">ccswitch://v1/import?...</code>）</li>
                  <li>Claude Code / Codex 环境变量与 <code className="text-blue-600 dark:text-blue-400">settings.json</code> / <code className="text-blue-600 dark:text-blue-400">.env</code></li>
                </ul>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    配置内容（粘贴或选择文件）
                  </label>
                  <label className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1 font-medium">
                    <IconUpload className="w-3.5 h-3.5" />
                    <span>选择本地文件 (.sql / .json)</span>
                    <input
                      type="file"
                      accept=".sql,.json,.txt,.env"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const content = event.target?.result as string;
                            if (content) {
                              setImportRaw(content);
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>
                <Textarea
                  rows={8}
                  className="font-mono text-xs"
                  placeholder="在此粘贴 CC-Switch 导出的 SQL 语句、JSON 配置或 ccswitch:// 链接..."
                  value={importRaw}
                  onChange={(e) => setImportRaw(e.target.value)}
                />
              </div>

              {importError ? (
                <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg">
                  {importError}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button type="button" variant="secondary" onClick={() => setShowImportModal(false)}>
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={!importRaw.trim() || parsing}
                  onClick={handleParsePreview}
                >
                  {parsing ? "正在解析…" : "解析配置"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  解析到 {importPreview.length} 个 Provider 配置：
                </div>
                <button
                  type="button"
                  onClick={toggleSelectAllImport}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-medium"
                >
                  {importSelectedIndices.size === importPreview.length ? "取消全选" : "全选全部"}
                </button>
              </div>

              <div className="max-h-[300px] overflow-y-auto space-y-2.5 pr-1">
                {importPreview.map((item, idx) => {
                  const isChecked = importSelectedIndices.has(idx);
                  return (
                    <div
                      key={idx}
                      onClick={() => toggleSelectImportIndex(idx)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer select-none ${
                        isChecked
                          ? "bg-blue-50/40 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                          : "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                              {item.name}
                            </span>
                            <Badge
                              tone={
                                item.type === "anthropic"
                                  ? "purple"
                                  : item.type === "gemini"
                                  ? "amber"
                                  : "blue"
                              }
                            >
                              {item.type === "anthropic"
                                ? "Anthropic"
                                : item.type === "gemini"
                                ? "Gemini"
                                : "OpenAI"}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                            {item.endpoint || "官方默认 Endpoint"}
                          </div>
                          {item.api_key_masked && (
                            <div className="mt-0.5 text-xs font-mono text-slate-600 dark:text-slate-400">
                              密钥: {item.api_key_masked}
                            </div>
                          )}
                          {item.models && item.models.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-slate-400 dark:text-slate-500">模型 ({item.models.length}):</span>
                              {item.models.slice(0, 4).map((m, mIdx) => (
                                <span
                                  key={mIdx}
                                  className="inline-block px-1.5 py-0.5 bg-slate-200/60 dark:bg-slate-800 text-[10px] font-mono text-slate-700 dark:text-slate-300 rounded"
                                >
                                  {m.display_name || m.model_name}
                                </span>
                              ))}
                              {item.models.length > 4 && (
                                <span className="text-[10px] text-slate-400">+{item.models.length - 4}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="import-models-opt"
                    checked={importModels}
                    onChange={(e) => setImportModels(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label
                    htmlFor="import-models-opt"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none"
                  >
                    同时自动创建提取到的模型
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="import-overwrite-opt"
                    checked={importOverwrite}
                    onChange={(e) => setImportOverwrite(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label
                    htmlFor="import-overwrite-opt"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none"
                  >
                    若存在同名 Provider 则覆盖更新配置（未勾选时将作为新 Provider 导入）
                  </label>
                </div>
              </div>

              {importError ? (
                <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg">
                  {importError}
                </div>
              ) : null}

              {importSuccess ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-lg">
                  {importSuccess}
                </div>
              ) : null}

              <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setImportPreview(null);
                    setImportSuccess(null);
                    setImportError("");
                  }}
                  disabled={importing}
                >
                  重新输入
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowImportModal(false)}
                    disabled={importing}
                  >
                    关闭
                  </Button>
                  <Button
                    type="button"
                    disabled={importSelectedIndices.size === 0 || importing}
                    onClick={handleExecuteImport}
                  >
                    {importing
                      ? "正在导入…"
                      : `导入选中的 ${importSelectedIndices.size} 项`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
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
