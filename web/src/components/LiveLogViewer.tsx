import { useState, useEffect, useRef } from "react";
import { api, fmtNum, fmtTime } from "../api/client";
import type { UsageItem } from "../types";
import { Badge, Button, Empty, Spinner } from "./ui";
import { IconActivity, IconZap, IconRefresh, IconTrash } from "./icons";

export function LiveLogViewer() {
  const [logs, setLogs] = useState<UsageItem[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const lastIdRef = useRef<number | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchNewLogs = async () => {
    try {
      const q = lastIdRef.current ? `?after_id=${lastIdRef.current}&limit=25` : "?limit=20";
      const res = await api.get<{ items: UsageItem[] }>(`/api/usage/latest${q}`);
      if (res.items && res.items.length > 0) {
        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const newUnique = res.items.filter((l) => !existingIds.has(l.id));
          if (!newUnique.length) return prev;
          const combined = [...newUnique, ...prev].slice(0, 80);
          lastIdRef.current = combined[0]?.id;
          return combined;
        });
      }
    } catch {
      // Background poll failure should be silent
    }
  };

  useEffect(() => {
    // Initial fetch
    setLoading(true);
    fetchNewLogs().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchNewLogs, 2500);
    return () => clearInterval(interval);
  }, [isLive]);

  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [logs, autoScroll]);

  return (
    <div className="space-y-3">
      {/* Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isLive ? "bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/50" : "bg-slate-400"
              }`}
            />
            {isLive ? "实时推流中 (2.5s 刷新)" : "已暂停实时流"}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
            ({logs.length} 条记录)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={isLive ? "secondary" : "primary"}
            onClick={() => setIsLive(!isLive)}
            className="text-xs h-7 px-2.5"
          >
            {isLive ? "⏸ 暂停" : "▶ 继续推流"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLogs([]);
              lastIdRef.current = undefined;
            }}
            className="text-xs h-7 px-2"
            title="清空当前列表"
          >
            <IconTrash className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">清空</span>
          </Button>
        </div>
      </div>

      {/* Log Feed Table/List */}
      <div
        ref={scrollContainerRef}
        className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 overflow-y-auto max-h-[380px] divide-y divide-slate-100 dark:divide-slate-800/80"
      >
        {loading && !logs.length ? (
          <div className="py-12">
            <Spinner text="正在连接实时日志流…" />
          </div>
        ) : !logs.length ? (
          <div className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">
            暂无请求日志，发起网关 API 调用后将在此处实时刷新
          </div>
        ) : (
          logs.map((log) => {
            const isSuccess = log.status_code && log.status_code < 400;
            const isCacheHit = Boolean(log.cache_hit);
            return (
              <div
                key={log.id}
                className="px-3.5 py-2.5 hover:bg-white dark:hover:bg-slate-850 transition-colors flex items-center justify-between gap-3 text-xs"
              >
                {/* Left: Status Badge & Model */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] shrink-0 ${
                      isCacheHit
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300"
                        : isSuccess
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                    }`}
                  >
                    {isCacheHit ? "CACHE" : log.status_code || "200"}
                  </span>

                  <span className="font-semibold text-slate-800 dark:text-slate-100 font-mono truncate">
                    {log.model || "unknown-model"}
                  </span>

                  <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400 truncate max-w-[100px]">
                    {log.provider_name || log.provider_id || "provider"}
                  </span>
                </div>

                {/* Right: Latency & Tokens & Time */}
                <div className="flex items-center gap-3 shrink-0 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {fmtNum(log.total_tokens || 0)} <span className="text-[10px] text-slate-400">tok</span>
                  </span>

                  <span className={`${log.latency_ms && log.latency_ms > 2000 ? "text-amber-600 dark:text-amber-400 font-bold" : ""}`}>
                    {log.latency_ms != null ? `${log.latency_ms}ms` : "-"}
                  </span>

                  <span className="text-slate-400 dark:text-slate-500 text-[10px] hidden md:inline">
                    {fmtTime(log.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
