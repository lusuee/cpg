export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const tzOffset = String(new Date().getTimezoneOffset());
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "X-Timezone-Offset": tzOffset,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
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
  download: async (path: string, defaultFilename = "export.csv") => {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) {
      let data: { error?: string; message?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        // ignore
      }
      throw new ApiError(data?.error || data?.message || `HTTP ${res.status}`, res.status);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    let filename = defaultFilename;
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match?.[1]) filename = match[1];
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}
export function fmtNum(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}
