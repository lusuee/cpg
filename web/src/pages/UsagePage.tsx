import { useCallback, useEffect, useState } from "react";
import { api, fmtNum, fmtTime } from "../api/client";
import type { Provider, UsageItem } from "../types";
import { Badge, Button, Card, Empty, Input, Select, Spinner } from "../components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function UsagePage() {
  const [items, setItems] = useState<UsageItem[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [range, setRange] = useState("24h");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const buildQuery = useCallback((offset: number) => {
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
  }, [range, providerId, model]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ items: UsageItem[] }>(`/api/usage?${buildQuery(0)}`);
      setItems(res.items);
      setHasMore(res.items.length === 50);
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
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.items.length === 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    api.get<{ items: Provider[] }>("/api/providers")
      .then((res) => setProviders(res.items))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">用量记录</h1>
      <Card className="overflow-x-auto">
        <div className="mb-3 flex flex-wrap gap-3">
          <Select className="w-40" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="all">全部</option>
          </Select>
          <Select className="w-56" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">全部 Provider</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input className="w-64" placeholder="按模型名筛选，例如 claude" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>

        {error ? <div className="mb-2 text-sm text-red-600">{error}</div> : null}
        {loading ? <Spinner /> : items.length ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th>时间</th>
                  <th>状态</th>
                  <th>模型</th>
                  <th>Provider</th>
                  <th>设备</th>
                  <th className="text-right">In</th>
                  <th className="text-right">Out</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">延迟</th>
                  <th>请求 ID</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="py-2 whitespace-nowrap text-slate-500">{fmtTime(u.created_at)}</td>
                    <td><Badge tone={u.status_code && u.status_code >= 400 ? "red" : "green"}>{u.status_code ?? "-"}</Badge></td>
                    <td className="font-medium">{u.model || "-"}</td>
                    <td>{u.provider_name || "-"}</td>
                    <td className="text-slate-500">{u.device_id || "-"}</td>
                    <td className="text-right">{fmtNum(u.input_tokens)}</td>
                    <td className="text-right">{fmtNum(u.output_tokens)}</td>
                    <td className="text-right">{fmtNum(u.total_tokens)}</td>
                    <td className="text-right text-slate-500">{u.latency_ms != null ? `${u.latency_ms}ms` : "-"}</td>
                    <td className="max-w-40 truncate text-slate-400">{u.request_id || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore ? (
              <div className="mt-3 text-center">
                <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "加载中…" : "加载更多"}</Button>
              </div>
            ) : null}
          </>
        ) : <Empty text="暂无用量记录" />}
      </Card>
    </div>
  );
}
