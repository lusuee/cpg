import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button, Input } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import { ApiError } from "../api/client";
import { IconZap, IconShield } from "../components/icons";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败，请检查密码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20 p-4 transition-colors">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/25 mb-4">
            <IconZap className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">AI Gateway</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">请输入管理员密码访问控制台</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/50 backdrop-blur-sm"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              管理端密码 (ADMIN_SECRET)
            </label>
            <Input
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>

          {error ? (
            <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 p-2.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <span>{error}</span>
            </div>
          ) : null}

          <Button disabled={busy} className="w-full justify-center py-2 text-sm shadow-md" size="lg">
            {busy ? "正在验证…" : "进入管理端"}
          </Button>

          <div className="pt-2 text-center flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <IconShield className="w-3.5 h-3.5" />
            <span>端到端 HMAC 安全签名会话</span>
          </div>
        </form>
      </div>
    </div>
  );
}
