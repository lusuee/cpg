import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";

interface AuthContextValue {
  loading: boolean;
  authenticated: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    api
      .get<{ ok: boolean }>("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    await api.post<{ ok: boolean }>("/api/auth/login", { password });
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setAuthenticated(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ loading, authenticated, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
