import { useCallback, useEffect, useRef, useState } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

export function invalidateCache(prefix?: string) {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

export function setCacheData<T>(key: string, data: T) {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

export function getCacheData<T>(key: string): T | undefined {
  return memoryCache.get(key)?.data;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: (silent?: boolean) => Promise<T | undefined>;
  mutate: (newData: T | ((prev: T | undefined) => T), revalidate?: boolean) => void;
}

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options?: {
    ttlMs?: number;
    enabled?: boolean;
  }
): UseQueryResult<T> {
  const { ttlMs = 60_000, enabled = true } = options || {};
  const cached = key ? memoryCache.get(key) : undefined;
  const isFresh = cached && Date.now() - cached.timestamp < ttlMs;

  const [data, setData] = useState<T | undefined>(cached?.data);
  const [loading, setLoading] = useState<boolean>(enabled && !cached);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const executeFetch = useCallback(
    async (silent = false): Promise<T | undefined> => {
      if (!key || !enabled) return undefined;
      if (!silent && !memoryCache.has(key)) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);
      try {
        const result = await fetcherRef.current();
        memoryCache.set(key, { data: result, timestamp: Date.now() });
        setData(result);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [key, enabled]
  );

  useEffect(() => {
    if (!key || !enabled) return;

    const currentCached = memoryCache.get(key);
    if (currentCached) {
      setData(currentCached.data);
      // Background revalidation
      executeFetch(true).catch(() => {});
    } else {
      executeFetch(false).catch(() => {});
    }
  }, [key, enabled, executeFetch]);

  const mutate = useCallback(
    (newData: T | ((prev: T | undefined) => T), revalidate = false) => {
      if (!key) return;
      setData((prev) => {
        const resolved = typeof newData === "function" ? (newData as any)(prev) : newData;
        memoryCache.set(key, { data: resolved, timestamp: Date.now() });
        if (revalidate) {
          executeFetch(true).catch(() => {});
        }
        return resolved;
      });
    },
    [key, executeFetch]
  );

  return {
    data,
    loading,
    isRefreshing,
    error,
    refresh: executeFetch,
    mutate,
  };
}
