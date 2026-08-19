import { useCallback, useEffect, useState } from "react";
import { api, fmtNum, fmtTime } from "../api/client";
import type { Provider, UsageItem } from "../types";
import { Badge, Button, Card, Empty, Input, Select, Spinner, CopyButton } from "../components/ui";
import { IconUsage, IconSearch, IconRefresh } from "../components/icons";
import { useQuery, getCacheData, setCacheData } from "../hooks/useQuery";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function UsagePage() {
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">API 调用与用量日志</h2>
          <p className="text-xs text-slate-500 mt-1">
            实时记录每次网关透传请求、消耗的 Token 数、网络延迟与上游响应状态
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <IconRefresh />
          <span>刷新记录</span>
        </Button>
      </div>

      <Card>
        {/* Filters Bar */}
        <div className="flex flex-wrap items-center gap-3 pb-4 mb-4 border-b border-slate-100">
          <div className="w-40">
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="24h">最近 24 小时</option>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="all">全部历史记录</option>
            </Select>
          </div>
          <div className="w-48">
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">全部 Provider</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-60 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
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
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              重置筛选
            </Button>
          )}
        </div>

        {error ? <div className="mb-4 text-xs text-rose-600 bg-rose-50 p-3 rounded-lg">{error}</div> : null}

        {loading ? (
          <Spinner text="正在获取日志数据…" />
        ) : items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-medium">
                    <th className="pb-3 px-2">请求时间</th>
                    <th className="pb-3 px-2">状态码</th>
                    <th className="pb-3 px-2">模型</th>
                    <th className="pb-3 px-2">Provider</th>
                    <th className="pb-3 px-2">设备来源</th>
                    <th className="pb-3 px-2 text-right">In Tokens</th>
                    <th className="pb-3 px-2 text-right">Out Tokens</th>
                    <th className="pb-3 px-2 text-right">总 Tokens</th>
                    <th className="pb-3 px-2 text-right">预估费用</th>
                    <th className="pb-3 px-2 text-right">响应延迟</th>
                    <th className="pb-3 px-2">Request ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-2 text-slate-500 whitespace-nowrap text-xs">{fmtTime(u.created_at)}</td>
                      <td className="py-3 px-2">
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
                      </td>
                      <td className="py-3 px-2 font-mono font-medium text-slate-900">{u.model || "-"}</td>
                      <td className="py-3 px-2 text-slate-600">{u.provider_name || "-"}</td>
                      <td className="py-3 px-2 text-slate-400 text-xs truncate max-w-[120px]">
                        {u.device_id || "-"}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500 text-xs">{fmtNum(u.input_tokens)}</td>
                      <td className="py-3 px-2 text-right font-mono text-slate-500 text-xs">{fmtNum(u.output_tokens)}</td>
                      <td className="py-3 px-2 text-right font-mono font-semibold text-slate-800 text-xs">
                        {fmtNum(u.total_tokens)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-xs text-purple-600 font-medium">
                        {u.cost_usd ? `$${u.cost_usd.toFixed(4)}` : "$0.0000"}
                      </td>
                      <td className="py-3 px-2 text-right text-xs">
                        {u.latency_ms != null ? (
                          <span
                            className={`font-mono ${
                              u.latency_ms > 5000
                                ? "text-amber-600"
                                : u.latency_ms > 15000
                                ? "text-rose-600"
                                : "text-slate-600"
                            }`}
                          >
                            {u.latency_ms}ms
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        {u.request_id ? (
                          <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400">
                            <span className="truncate max-w-[100px]">{u.request_id}</span>
                            <CopyButton text={u.request_id} />
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
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
              <div className="mt-6 text-center text-xs text-slate-400">已加载全部结果</div>
            )}
          </>
        ) : (
          <Empty text="未找到符合条件的用量记录" icon={<IconUsage className="w-8 h-8" />} />
        )}
      </Card>
    </div>
  );
}
