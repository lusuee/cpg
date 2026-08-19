import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtNum, fmtTime } from "../api/client";
import type { StatsResponse, UsageItem } from "../types";
import { Badge, Card, Empty, Spinner, CopyButton } from "../components/ui";
import { IconActivity, IconZap, IconTerminal } from "../components/icons";

export default function DashboardPage() {
  const [stats, setStats] = useState<Record<string, StatsResponse>>({});
  const [recent, setRecent] = useState<UsageItem[]>([]);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [today, d7, d30, usage, settings] = await Promise.all([
          api.get<StatsResponse>("/api/usage/stats?range=today"),
          api.get<StatsResponse>("/api/usage/stats?range=7d"),
          api.get<StatsResponse>("/api/usage/stats?range=30d"),
          api.get<{ items: UsageItem[] }>("/api/usage?limit=8"),
          api.get<{ gateway_base_url: string }>("/api/settings").catch(() => ({ gateway_base_url: "" })),
        ]);
        setStats({ today, d7, d30 });
        setRecent(usage.items || []);
        setGatewayUrl(settings.gateway_base_url || window.location.origin);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner text="正在加载网关统计…" />;

  const t = stats.today?.summary || { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, error_count: 0 };
  const providerRows = stats.today?.byProvider || [];
  const modelRows = stats.today?.byModel || [];
  const trend = stats.d7?.trend || [];

  return (
    <div className="space-y-6">
      {/* Quick Gateway Endpoint Widget */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-lg shadow-blue-500/15 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md">
            <IconTerminal className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-blue-100">网关接入地址</div>
            <div className="font-mono text-sm sm:text-base font-semibold text-white mt-0.5">{gatewayUrl || "https://ai.example.com"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl text-xs">
          <span className="text-blue-100">OpenAI & Anthropic 兼容</span>
          <CopyButton text={gatewayUrl || window.location.origin} label="复制 Base URL" />
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="今日总请求"
          value={fmtNum(t.request_count)}
          sub={`错误率 ${t.request_count ? ((t.error_count / t.request_count) * 100).toFixed(1) : 0}%`}
          tone="blue"
        />
        <StatCard
          label="今日输入 Token"
          value={fmtNum(t.input_tokens)}
          sub={`占比 ${t.total_tokens ? Math.round((t.input_tokens / t.total_tokens) * 100) : 0}%`}
          tone="slate"
        />
        <StatCard
          label="今日输出 Token"
          value={fmtNum(t.output_tokens)}
          sub={`总计 ${fmtNum(t.total_tokens)} Tokens`}
          tone="green"
        />
        <StatCard
          label="今日异常请求"
          value={fmtNum(t.error_count)}
          sub={t.error_count > 0 ? "需关注异常上游" : "全部正常响应"}
          tone={t.error_count > 0 ? "red" : "slate"}
        />
      </div>

      {/* Trend & Providers */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="最近 7 天请求量趋势">
          {trend.length ? (
            <div className="pt-2">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" fontSize={11} stroke="#94a3b8" tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      borderRadius: "8px",
                      border: "none",
                      color: "#fff",
                      fontSize: "12px",
                      padding: "8px 12px",
                    }}
                    cursor={{ fill: "rgba(59, 130, 246, 0.05)" }}
                  />
                  <Bar dataKey="requests" name="请求数" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty text="暂无 7 天趋势数据" />
          )}
        </Card>

        <Card title="今日 Provider 分布">
          <BreakdownTable rows={providerRows} />
        </Card>
      </div>

      {/* Models & Recent Requests */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="今日 Model 使用分布">
          <BreakdownTable rows={modelRows} />
        </Card>

        <Card title="最近调用日志">
          {recent.length ? (
            <div className="divide-y divide-slate-100">
              {recent.map((u) => (
                <div key={u.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Badge
                      tone={u.status_code && u.status_code >= 400 ? "red" : u.status_code ? "green" : "slate"}
                      dot
                    >
                      {u.status_code ?? "-"}
                    </Badge>
                    <span className="font-semibold text-slate-800 truncate max-w-[140px] sm:max-w-[200px]">
                      {u.model || "-"}
                    </span>
                    <span className="text-slate-400 text-[11px] truncate">{u.provider_name || "-"}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono text-slate-500">{fmtNum(u.total_tokens)} T</span>
                    <span className="text-slate-400">{fmtTime(u.created_at).slice(11)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="暂无调用记录" />
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "blue" | "green" | "red" | "slate";
}) {
  const toneBg = {
    blue: "text-blue-600",
    green: "text-emerald-600",
    red: "text-rose-600",
    slate: "text-slate-800",
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl sm:text-3xl font-bold tracking-tight ${toneBg[tone]}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium text-slate-400">{sub}</div>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: Array<{ name: string; requests: number; tokens: number }> }) {
  if (!rows.length) return <Empty text="今日暂无使用记录" />;

  const maxTokens = Math.max(...rows.map((r) => r.tokens), 1);

  return (
    <div className="divide-y divide-slate-100">
      {rows.map((r) => (
        <div key={r.name} className="py-2.5">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-slate-800 truncate max-w-[200px]">{r.name}</span>
            <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
              <span>{fmtNum(r.requests)} 次</span>
              <span className="font-semibold text-slate-700">{fmtNum(r.tokens)} Tokens</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, (r.tokens / maxTokens) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
