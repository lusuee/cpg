import { useCallback } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtNum, fmtTime } from "../api/client";
import type { StatsResponse, UsageItem } from "../types";
import { Badge, Card, Empty, Spinner, CopyButton } from "../components/ui";
import { IconActivity, IconZap, IconTerminal } from "../components/icons";
import { useQuery } from "../hooks/useQuery";
import { useTheme } from "../hooks/useTheme";

interface DashboardData {
  stats: Record<string, StatsResponse>;
  recent: UsageItem[];
  gatewayUrl: string;
}

export default function DashboardPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
    const [todayRes, d7Res, d30Res, usageRes, settingsRes] = await Promise.allSettled([
      api.get<StatsResponse>("/api/usage/stats?range=today"),
      api.get<StatsResponse>("/api/usage/stats?range=7d"),
      api.get<StatsResponse>("/api/usage/stats?range=30d"),
      api.get<{ items: UsageItem[] }>("/api/usage?limit=8"),
      api.get<{ gateway_base_url: string }>("/api/settings"),
    ]);

    const emptyStats: StatsResponse = {
      range: "today",
      since: Date.now(),
      summary: { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, avg_latency_ms: 0, error_count: 0, cache_hit_count: 0 },
      byProvider: [],
      byModel: [],
      trend: [],
    };

    const today = todayRes.status === "fulfilled" ? todayRes.value : emptyStats;
    const d7 = d7Res.status === "fulfilled" ? d7Res.value : { ...emptyStats, range: "7d" };
    const d30 = d30Res.status === "fulfilled" ? d30Res.value : { ...emptyStats, range: "30d" };
    const usage = usageRes.status === "fulfilled" ? usageRes.value : { items: [] };
    const settings = settingsRes.status === "fulfilled" ? settingsRes.value : { gateway_base_url: "" };

    return {
      stats: { today, d7, d30 },
      recent: usage.items || [],
      gatewayUrl: settings.gateway_base_url || window.location.origin,
    };
  }, []);

  const { data, loading } = useQuery("dashboard-data", fetchDashboard, { ttlMs: 30_000 });

  if (loading && !data) return <Spinner text="正在加载网关统计…" />;

  const stats = data?.stats || {};
  const recent = data?.recent || [];
  const gatewayUrl = data?.gatewayUrl || "";
  const t = stats.today?.summary || { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, error_count: 0 };
  const providerRows = stats.today?.byProvider || [];
  const modelRows = stats.today?.byModel || [];
  const trend = stats.d7?.trend || [];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Quick Gateway Endpoint Widget */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-lg shadow-blue-500/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 sm:p-2.5 rounded-xl bg-white/10 backdrop-blur-md shrink-0">
            <IconTerminal className="w-4 h-4 sm:w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold text-blue-100">网关接入地址</div>
            <div className="font-mono text-xs sm:text-base font-semibold text-white mt-0.5 break-all">{gatewayUrl || "https://ai.example.com"}</div>
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-2 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl text-xs shrink-0">
          <span className="text-blue-100 text-[11px] sm:text-xs">OpenAI & Anthropic 兼容</span>
          <CopyButton text={gatewayUrl || window.location.origin} label="复制 Base URL" />
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-4">
        <StatCard
          label="今日总请求"
          value={fmtNum(t.request_count)}
          sub={`错误率 ${t.request_count ? ((t.error_count / t.request_count) * 100).toFixed(1) : 0}%`}
          tone="blue"
        />
        <StatCard
          label="缓存命中率"
          value={t.request_count ? `${(((t.cache_hit_count || 0) / t.request_count) * 100).toFixed(1)}%` : "0.0%"}
          sub={t.cache_hit_count ? `命中 ${fmtNum(t.cache_hit_count)} 次` : "暂无命中"}
          tone="purple"
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
          sub={`总计 ${fmtNum(t.total_tokens)} T`}
          tone="green"
        />
        <StatCard
          label="今日预估费用"
          value={t.cost_usd ? `$${t.cost_usd.toFixed(4)}` : "$0.0000"}
          sub="按模型定价估算"
          tone="slate"
        />
        <StatCard
          label="今日异常请求"
          value={fmtNum(t.error_count)}
          sub={t.error_count > 0 ? "需关注异常上游" : "全部正常响应"}
          tone={t.error_count > 0 ? "red" : "slate"}
        />
      </div>

      {/* Trend & Providers */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="最近 7 天请求量趋势">
          {trend.length ? (
            <div className="pt-2 -ml-3 sm:ml-0">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={trend} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                  <XAxis dataKey="date" fontSize={10} stroke={isDark ? "#64748b" : "#94a3b8"} tickLine={false} />
                  <YAxis allowDecimals={false} fontSize={10} stroke={isDark ? "#64748b" : "#94a3b8"} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#1e293b",
                      borderRadius: "8px",
                      border: isDark ? "1px solid #334155" : "none",
                      color: "#fff",
                      fontSize: "12px",
                      padding: "8px 12px",
                    }}
                    cursor={{ fill: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(59, 130, 246, 0.05)" }}
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
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="今日 Model 使用分布">
          <BreakdownTable rows={modelRows} />
        </Card>

        <Card title="最近调用日志">
          {recent.length ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recent.map((u) => (
                <div key={u.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                    <Badge
                      tone={u.status_code && u.status_code >= 400 ? "red" : u.status_code ? "green" : "slate"}
                      dot
                    >
                      {u.status_code ?? "-"}
                    </Badge>
                    {u.cache_hit ? (
                      <Badge tone="purple" title="命中 KV 响应缓存">
                        ⚡ HIT
                      </Badge>
                    ) : null}
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[100px] xs:max-w-[140px] sm:max-w-[200px]">
                      {u.model || "-"}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500 text-[11px] truncate hidden sm:inline">{u.provider_name || "-"}</span>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <span className="font-mono text-slate-500 dark:text-slate-400">{fmtNum(u.total_tokens)} T</span>
                    <span className="text-slate-400 dark:text-slate-500 text-[11px]">{fmtTime(u.created_at).slice(11)}</span>
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
  tone?: "blue" | "green" | "red" | "purple" | "slate";
}) {
  const toneBg = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-rose-600 dark:text-rose-400",
    purple: "text-purple-600 dark:text-purple-400",
    slate: "text-slate-800 dark:text-slate-100",
  };

  return (
    <div className="rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-5 shadow-xs sm:shadow-sm transition-all hover:shadow-md">
      <div className="text-[11px] sm:text-xs font-medium text-slate-400 dark:text-slate-500 truncate">{label}</div>
      <div className={`mt-1.5 sm:mt-2 text-lg sm:text-2xl lg:text-3xl font-bold tracking-tight truncate ${toneBg[tone]}`}>{value}</div>
      <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate">{sub}</div>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: Array<{ name: string; requests: number; tokens: number }> }) {
  if (!rows.length) return <Empty text="今日暂无使用记录" />;

  const maxTokens = Math.max(...rows.map((r) => r.tokens), 1);

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((r) => (
        <div key={r.name} className="py-2.5">
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[140px] sm:max-w-[200px]">{r.name}</span>
            <div className="flex items-center gap-2 sm:gap-3 text-slate-500 dark:text-slate-400 font-mono text-[11px] shrink-0">
              <span>{fmtNum(r.requests)} 次</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{fmtNum(r.tokens)} Tokens</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, (r.tokens / maxTokens) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
