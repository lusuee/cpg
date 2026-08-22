import { useCallback, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { api, fmtNum, fmtTime } from "../api/client";
import type { StatsResponse, UsageItem, CacheAnalyticsResponse, ModelLatencyItem } from "../types";
import { Badge, Card, Empty, Spinner, CopyButton, Button } from "../components/ui";
import { IconActivity, IconZap, IconTerminal, IconShield } from "../components/icons";
import { LiveLogViewer } from "../components/LiveLogViewer";
import { useQuery } from "../hooks/useQuery";
import { useTheme } from "../hooks/useTheme";

interface DashboardData {
  stats: Record<string, StatsResponse>;
  recent: UsageItem[];
  cacheStats: CacheAnalyticsResponse;
  modelLatency: ModelLatencyItem[];
  gatewayUrl: string;
}

export default function DashboardPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [showLiveStream, setShowLiveStream] = useState(false);

  const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
    const [todayRes, d7Res, d30Res, usageRes, cacheRes, latencyRes, settingsRes] = await Promise.allSettled([
      api.get<StatsResponse>("/api/usage/stats?range=today"),
      api.get<StatsResponse>("/api/usage/stats?range=7d"),
      api.get<StatsResponse>("/api/usage/stats?range=30d"),
      api.get<{ items: UsageItem[] }>("/api/usage?limit=8"),
      api.get<CacheAnalyticsResponse>("/api/usage/cache-stats?range=today"),
      api.get<{ items: ModelLatencyItem[] }>("/api/usage/model-latency?range=today"),
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

    const emptyCache: CacheAnalyticsResponse = {
      total_requests: 0,
      cache_hits: 0,
      cache_hit_rate: 0,
      tokens_saved: 0,
      cost_saved_usd: 0,
      avg_cached_latency_ms: 0,
      avg_direct_latency_ms: 0,
      acceleration_ratio: 1,
    };

    const today = todayRes.status === "fulfilled" ? todayRes.value : emptyStats;
    const d7 = d7Res.status === "fulfilled" ? d7Res.value : { ...emptyStats, range: "7d" };
    const d30 = d30Res.status === "fulfilled" ? d30Res.value : { ...emptyStats, range: "30d" };
    const usage = usageRes.status === "fulfilled" ? usageRes.value : { items: [] };
    const cacheStats = cacheRes.status === "fulfilled" ? cacheRes.value : emptyCache;
    const modelLatency = latencyRes.status === "fulfilled" ? latencyRes.value.items || [] : [];
    const settings = settingsRes.status === "fulfilled" ? settingsRes.value : { gateway_base_url: "" };

    return {
      stats: { today, d7, d30 },
      recent: usage.items || [],
      cacheStats,
      modelLatency,
      gatewayUrl: settings.gateway_base_url || window.location.origin,
    };
  }, []);

  const { data, loading } = useQuery("dashboard-data", fetchDashboard, { ttlMs: 30_000 });

  if (loading && !data) return <Spinner text="正在加载网关统计…" />;

  const stats = data?.stats || {};
  const recent = data?.recent || [];
  const cacheStats = data?.cacheStats;
  const modelLatency = data?.modelLatency || [];
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
          sub={t.cache_hit_count ? `节省 $${cacheStats?.cost_saved_usd || 0}` : "暂无命中"}
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
          sub={`占比 ${t.total_tokens ? Math.round((t.output_tokens / t.total_tokens) * 100) : 0}%`}
          tone="slate"
        />
        <StatCard
          label="今日总 Token"
          value={fmtNum(t.total_tokens)}
          sub={`7日 ${fmtNum(stats.d7?.summary?.total_tokens || 0)}`}
          tone="green"
        />
        <StatCard
          label="今日预估费用"
          value={`$${(t.cost_usd || 0).toFixed(3)}`}
          sub={`30日 $${(stats.d30?.summary?.cost_usd || 0).toFixed(2)}`}
          tone="slate"
        />
      </div>

      {/* Feature 2: Cache Hit & Cost Savings Analytics Card */}
      {cacheStats && (
        <div className="p-4 sm:p-5 rounded-2xl border border-purple-100 dark:border-purple-900/40 bg-gradient-to-r from-purple-50/50 via-indigo-50/30 to-blue-50/40 dark:from-purple-950/20 dark:via-indigo-950/15 dark:to-blue-950/20 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-sm shadow-purple-500/20">
                <IconZap className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                  响应缓存加速与成本节约
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  基于 Cloudflare 边缘缓存，消除重复提示词与测试请求的上游开销
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-xs font-semibold">
                ⚡ 缓存加速比: {cacheStats.acceleration_ratio}x
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">命中次数 / 总请求</div>
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mt-1">
                {cacheStats.cache_hits} <span className="text-xs text-slate-400 font-normal">/ {cacheStats.total_requests} ({cacheStats.cache_hit_rate}%)</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">累计节省 Token</div>
              <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                {fmtNum(cacheStats.tokens_saved)} <span className="text-xs text-slate-400 font-normal">Tokens</span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">累计节省上游费用</div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                ${cacheStats.cost_saved_usd.toFixed(4)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">缓存平均延迟</div>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">
                {cacheStats.avg_cached_latency_ms}ms <span className="text-xs text-slate-400 font-normal">(上游: {cacheStats.avg_direct_latency_ms}ms)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature 3: Model Latency Benchmark & Trend Chart */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="近 7 日调用趋势">
          <div className="h-60 sm:h-72 w-full pt-2">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#f1f5f9"} vertical={false} />
                  <XAxis dataKey="date" stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} tickLine={false} />
                  <YAxis stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderColor: isDark ? "#334155" : "#e2e8f0",
                      borderRadius: "0.75rem",
                      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="requests" name="请求数" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty text="暂无趋势数据" />
            )}
          </div>
        </Card>

        {/* Feature 3: Multi-Model Latency Benchmark Horizontal BarChart */}
        <Card title="模型响应延迟横向评测 (ms)">
          <div className="h-60 sm:h-72 w-full pt-2">
            {modelLatency.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={modelLatency.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 30, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#f1f5f9"} horizontal={false} />
                  <XAxis type="number" stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={10} unit="ms" />
                  <YAxis type="category" dataKey="model" stroke={isDark ? "#64748b" : "#94a3b8"} fontSize={11} width={80} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderColor: isDark ? "#334155" : "#e2e8f0",
                      borderRadius: "0.75rem",
                      fontSize: "12px",
                    }}
                    formatter={(val: any, name: any) => [`${val} ms`, name === "avg_latency_ms" ? "平均响应耗时" : "P90 延迟"]}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "6px" }} />
                  <Bar dataKey="avg_latency_ms" name="平均耗时" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="p90_latency_ms" name="P90 耗时" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty text="暂无模型延迟数据，发起调用后自动生成评测" />
            )}
          </div>
        </Card>
      </div>

      {/* Distribution Tables */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="今日 Provider 分布">
          <BreakdownTable rows={providerRows} />
        </Card>

        <Card title="今日 Model 使用分布">
          <BreakdownTable rows={modelRows} />
        </Card>
      </div>

      {/* Feature 1: Live Log Viewer Toggle Section */}
      <Card
        title="网关请求日志"
        action={
          <Button
            size="sm"
            variant={showLiveStream ? "primary" : "outline"}
            onClick={() => setShowLiveStream(!showLiveStream)}
            className="text-xs h-7 px-2.5 shadow-xs"
          >
            {showLiveStream ? "📋 切换到静态日志" : "📡 开启实时日志流"}
          </Button>
        }
      >
        {showLiveStream ? (
          <LiveLogViewer />
        ) : recent.length ? (
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
                    <Badge tone="purple" title="命中响应缓存">
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
