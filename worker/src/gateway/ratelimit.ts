import type { Env } from "../types";

// In-memory sliding window for atomic and zero-latency RPM rate limiting
const memoryWindows = new Map<string, number[]>();

// Cleanup stale memory timestamps periodically
const CLEANUP_INTERVAL_MS = 60000;
let lastCleanup = Date.now();

function cleanupStaleMemory(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const threshold = now - 60000;
  for (const [key, timestamps] of memoryWindows.entries()) {
    const valid = timestamps.filter((t) => t > threshold);
    if (valid.length === 0) {
      memoryWindows.delete(key);
    } else {
      memoryWindows.set(key, valid);
    }
  }
}

/**
 * Checks and records a rate limit hit for a device using a 60-second sliding window.
 * Returns true if allowed, false if rate limit exceeded.
 */
export async function checkAndRecordRateLimit(
  env: Env,
  deviceId: string,
  rpm: number
): Promise<boolean> {
  if (!rpm || rpm <= 0) return true;

  const now = Date.now();
  cleanupStaleMemory(now);

  // 1. In-Memory Sliding Window Check
  const memKey = `ratelimit:mem:${deviceId}`;
  const timestamps = memoryWindows.get(memKey) || [];
  const oneMinuteAgo = now - 60000;
  const recent = timestamps.filter((t) => t > oneMinuteAgo);

  if (recent.length >= rpm) {
    return false;
  }

  // Record current request timestamp immediately
  recent.push(now);
  memoryWindows.set(memKey, recent);

  // 2. If KV is bound, check & increment KV counter for cross-isolate coordination
  if (env.CACHE_KV) {
    const minuteWindow = Math.floor(now / 60000);
    const kvKey = `ratelimit:kv:${deviceId}:${minuteWindow}`;
    try {
      const currentVal = await env.CACHE_KV.get(kvKey);
      const count = currentVal ? parseInt(currentVal, 10) : 0;
      if (count >= rpm) {
        return false;
      }
      await env.CACHE_KV.put(kvKey, String(count + 1), { expirationTtl: 70 });
    } catch {
      // KV failure falls back to in-memory sliding window
    }
  }

  return true;
}

// Reset memory windows (useful for unit tests)
export function resetRateLimitMemory(): void {
  memoryWindows.clear();
  lastCleanup = Date.now();
}
