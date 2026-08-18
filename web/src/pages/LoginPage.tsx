import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button, Input } from "../components/ui";
import { ApiError } from "../api/client";

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
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">AI Gateway 管理</h1>
        <label className="block text-sm font-medium text-slate-600">
          管理密码
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        <Button disabled={busy} className="w-full justify-center">{busy ? "登录中…" : "登录"}</Button>
      </form>
    </div>
  );
}
