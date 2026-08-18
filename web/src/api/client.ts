export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers || {}) } : init?.headers,
    ...init,
  });
  if (!res.ok) {
    let data: { error?: string; message?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    throw new ApiError(data?.error || data?.message || `HTTP ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}
export function fmtNum(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}
