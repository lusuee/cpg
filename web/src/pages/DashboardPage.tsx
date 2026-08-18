import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtNum, fmtTime } from "../api/client";
import type { StatsResponse, UsageItem } from "../types";
import { Badge, Card, Empty, Spinner } from "../components/ui";

type Dict = Record<string, any>;

export default function DashboardPage() {
  const [stats, setStats] = useState<Record<string, StatsResponse>>({});
  const [recent, setRecent] = useState<UsageItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [today, d7, d30, usage] = await Promise.all([
          api.get<StatsResponse>("/api/usage/stats?range=today"),
          api.get<StatsResponse>("/api/usage/stats?range=7d"),
          api.get<StatsResponse>("/api/usage/stats?range=30d"),
          api.get<{ items: UsageItem[] }>("/api/usage?limit=10"),
        ]);
        setStats({ today, d7, d30 });
        setRecent(usage.items || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner />;
  const t: Dict = stats.today?.summary || {};
  const providerRows = stats.today?.byProvider || [];
  const modelRows = stats.today?.byModel || [];
  const trend = stats.d7?.trend || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="今日请求" value={fmtNum(t.request_count)} />
        <Stat label="今日输入 Token" value={fmtNum(t.input_tokens)} />
        <Stat label="今日输出 Token" value={fmtNum(t.output_tokens)} />
        <Stat label="今日失败" value={fmtNum(t.error_count)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="7 天趋势（请求数）">
          {trend.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="requests" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty text="暂无趋势数据" />
          )}
        </Card>
        <Card title="今日 Provider 分布">
          <ProviderTable rows={providerRows} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="今日 Model 分布">
          <ProviderTable rows={modelRows} />
        </Card>
        <Card title="最近请求">
          {recent.length ? (
            <div className="space-y-2">
              {recent.map((u) => (
                <div key={u.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone={u.status_code && u.status_code >= 400 ? "red" : "green"}>{u.status_code ?? "-"}</Badge>
                    <span className="font-medium">{u.model || "-"}</span>
                    <span className="text-slate-500">{u.provider_name || "-"}</span>
                  </div>
                  <span className="text-slate-400">{fmtTime(u.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="暂无请求记录" />
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ProviderTable({ rows }: { rows: Array<Record<string, any>> }) {
  if (!rows.length) return <Empty />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-500">
          <th>名称</th>
          <th className="text-right">请求</th>
          <th className="text-right">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-slate-100">
            <td className="py-1.5">{r.name}</td>
            <td className="text-right">{fmtNum(r.requests)}</td>
            <td className="text-right">{fmtNum(r.tokens)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
