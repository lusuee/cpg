import { useCallback, useEffect, useState } from "react";
import { api, fmtNum, fmtTime } from "../api/client";
import type { Provider, UsageItem } from "../types";
import { Badge, Button, Card, Empty, Input, Select, Spinner, CopyButton } from "../components/ui";
import { IconUsage, IconSearch, IconRefresh, IconDownload, IconZap } from "../components/icons";
import { useToast } from "../components/Toast";
import { useQuery, getCacheData, setCacheData } from "../hooks/useQuery";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function UsagePage() {
  const toast = useToast();
  const fetchProviders = useCallback(async () => {
    const res = await api.get<{ items: Provider[] }>("/api/providers");
    return res.items || [];
  }, []);
  const { data: providers = [] } = useQuery("providers-list", fetchProviders);

  const [range, setRange] = useState("24h");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");

  const [items, setItems] = useState<UsageItem[]>(() => getCacheData("usage-page-items") || []);
  const [loading, setLoading] = useState(() => !getCacheData("usage-page-items"));
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const buildQuery = useCallback(
    (offset: number) => {
      const q = new URLSearchParams();
      q.set("limit", "50");
      if (offset) q.set("offset", String(offset));
      if (range !== "all") {
        const span = range === "7d" ? 7 * DAY_MS : range === "30d" ? 30 * DAY_MS : DAY_MS;
        q.set("from", String(Date.now() - span));
      }
      if (providerId) q.set("provider_id", providerId);
      if (model.trim()) q.set("model", model.trim());
      return q.toString();
    },
    [range, providerId, model]
  );

  const refresh = useCallback(async () => {
    if (!getCacheData("usage-page-items")) setLoading(true);
    setError("");
    try {
      const res = await api.get<{ items: UsageItem[] }>(`/api/usage?${buildQuery(0)}`);
      setItems(res.items || []);
      setCacheData("usage-page-items", res.items || []);
      setHasMore((res.items || []).length === 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const q = new URLSearchParams();
      q.set("limit", "10000");
      if (range !== "all") {
        const span = range === "7d" ? 7 * DAY_MS : range === "30d" ? 30 * DAY_MS : DAY_MS;
        q.set("from", String(Date.now() - span));
      }
      if (providerId) q.set("provider_id", providerId);
      if (model.trim()) q.set("model", model.trim());

      await api.download(`/api/usage/export?${q.toString()}`, `usage-export-${range}.csv`);
      toast.success("用量明细 CSV 已成功导出");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出 CSV 失败");
    } finally {
      setExporting(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.get<{ items: UsageItem[] }>(`/api/usage?${buildQuery(items.length)}`);
      setItems((prev) => {
        const updated = [...prev, ...(res.items || [])];
        setCacheData("usage-page-items", updated);
        return updated;
      });
      setHasMore((res.items || []).length === 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resetFilters = () => {
    setRange("24h");
    setProviderId("");
    setModel("");
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">API 调用与用量日志</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            实时记录每次网关透传请求、消耗的 Token 数、网络延迟与上游响应状态
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={exporting} className="flex-1 sm:flex-initial">
            <IconDownload />
            <span>{exporting ? "导出中…" : "导出 CSV"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => refresh()} className="flex-1 sm:flex-initial">
            <IconRefresh />
            <span>刷新记录</span>
          </Button>
        </div>
      </div>

      <Card>
        {/* Filters Bar */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 sm:gap-3 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="w-full sm:w-40">
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="24h">最近 24 小时</option>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="all">全部历史记录</option>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">全部 Provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-60 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
              <IconSearch />
            </div>
            <Input
              className="pl-9"
              placeholder="按模型名筛选…"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          {(range !== "24h" || providerId || model) && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="self-start sm:self-auto">
              重置筛选
            </Button>
          )}
        </div>

        {error ? <div className="mb-4 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-3 rounded-lg">{error}</div> : null}

        {loading ? (
          <Spinner text="正在获取日志数据…" />
        ) : items.length ? (
          <>
            <div className="overflow-x-auto -mx-4 -my-4 sm:mx-0 sm:my-0">
              <table className="w-full text-left text-xs sm:text-sm min-w-[860px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 font-medium">
                    <th className="pb-3 px-3 whitespace-nowrap">请求时间</th>
                    <th className="pb-3 px-2 whitespace-nowrap">状态 / 缓存</th>
                    <th className="pb-3 px-2 whitespace-nowrap">模型</th>
                    <th className="pb-3 px-2 whitespace-nowrap">Provider</th>
                    <th className="pb-3 px-2 whitespace-nowrap">设备来源</th>
                    <th className="pb-3 px-2 text-right whitespace-nowrap">In Tokens</th>
                    <th className="pb-3 px-2 text-right whitespace-nowrap">Out Tokens</th>
                    <th className="pb-3 px-2 text-right whitespace-nowrap">总 Tokens</th>
                    <th className="pb-3 px-2 text-right whitespace-nowrap">预估费用</th>
                    <th className="pb-3 px-2 text-right whitespace-nowrap">响应延迟</th>
                    <th className="pb-3 px-3 whitespace-nowrap">Request ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">{fmtTime(u.created_at)}</td>
                      <td className="py-3 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            tone={
                              u.status_code && u.status_code >= 500
                                ? "red"
                                : u.status_code && u.status_code >= 400
                                ? "amber"
                                : "green"
                            }
                            dot
                          >
                            {u.status_code ?? "-"}
                          </Badge>
                          {u.cache_hit ? (
                            <Badge tone="purple" title="该请求命中 Cloudflare KV 响应缓存">
                              ⚡ HIT
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{u.model || "-"}</td>
                      <td className="py-3 px-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{u.provider_name || "-"}</td>
                      <td className="py-3 px-2 text-slate-400 dark:text-slate-500 text-xs truncate max-w-[120px]">
                        {u.device_id || "-"}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">{fmtNum(u.input_tokens)}</td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">{fmtNum(u.output_tokens)}</td>
                      <td className="py-3 px-2 text-right font-mono font-semibold text-slate-800 dark:text-slate-200 text-xs whitespace-nowrap">
                        {fmtNum(u.total_tokens)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-xs font-medium whitespace-nowrap">
                        {u.cache_hit ? (
                          <span className="text-emerald-600 dark:text-emerald-400" title="命中缓存，无需向上游计费">
                            $0.0000
                          </span>
                        ) : u.cost_usd ? (
                          <span className="text-purple-600 dark:text-purple-400">${u.cost_usd.toFixed(4)}</span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">$0.0000</span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right text-xs whitespace-nowrap">
                        {u.latency_ms != null ? (
                          <span
                            className={`font-mono ${
                              u.cache_hit
                                ? "text-purple-600 dark:text-purple-400 font-semibold"
                                : u.latency_ms > 5000
                                ? "text-amber-600 dark:text-amber-400"
                                : u.latency_ms > 15000
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-slate-600 dark:text-slate-400"
                            }`}
                          >
                            {u.latency_ms}ms
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {u.request_id ? (
                          <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                            <span className="truncate max-w-[100px]">{u.request_id}</span>
                            <CopyButton text={u.request_id} />
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore ? (
              <div className="mt-6 text-center">
                <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "正在加载…" : "加载更多历史数据"}
                </Button>
              </div>
            ) : (
              <div className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">已加载全部结果</div>
            )}
          </>
        ) : (
          <Empty text="未找到符合条件的用量记录" icon={<IconUsage className="w-8 h-8" />} />
        )}
      </Card>
    </div>
  );
}
